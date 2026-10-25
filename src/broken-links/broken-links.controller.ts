import {
  Body,
  Controller,
  Get,
  HttpCode,
  HttpStatus,
  Logger,
  Param,
  Post,
  Query,
  Render,
  Res,
} from '@nestjs/common';
import { Throttle } from '@nestjs/throttler';
import type { Response } from 'express';
import * as XLSX from 'xlsx';
import { BrokenLinksService } from './broken-links.service';
import { CreateAuditDto } from './dto/create-audit.dto';
import { ResultsQueryDto } from './dto/results-query.dto';
import type { AuditResultRow, AuditSnapshot } from './types';

@Controller('broken-links')
export class BrokenLinksController {
  private readonly logger = new Logger(BrokenLinksController.name);

  constructor(private readonly brokenLinksService: BrokenLinksService) {}

  @Get()
  @Throttle({ default: { limit: 30, ttl: 60000 } })
  @Render('broken-links')
  page() {
    return {};
  }

  @Post()
  @HttpCode(HttpStatus.ACCEPTED)
  @Throttle({ default: { limit: 5, ttl: 60000 } })
  create(@Body() dto: CreateAuditDto): Promise<AuditSnapshot> {
    const target = dto.mode === 'sitemap' ? dto.sitemapUrl : dto.url;
    this.logger.log(
      `Creating broken link audit (${dto.mode ?? 'page'}) for ${target ?? 'unknown target'}`,
    );
    return this.brokenLinksService.createAudit(dto);
  }

  @Get(':id/stream')
  @Throttle({ default: { limit: 30, ttl: 60000 } })
  stream(@Param('id') id: string, @Res() res: Response): void {
    res.setHeader('Content-Type', 'text/event-stream');
    res.setHeader('Cache-Control', 'no-cache');
    res.setHeader('Connection', 'keep-alive');
    res.setHeader('X-Accel-Buffering', 'no');

    let closed = false;
    let interval: NodeJS.Timeout | null = null;

    const send = (payload: Record<string, unknown>): void => {
      if (closed || res.writableEnded) return;
      res.write(`data: ${JSON.stringify(payload)}\n\n`);
    };

    const stop = (): void => {
      if (interval) {
        clearInterval(interval);
        interval = null;
      }
    };

    const tick = (): void => {
      if (closed) return;
      try {
        const snapshot = this.brokenLinksService.getSnapshot(id);
        send({ type: 'progress', ...snapshot });
        if (
          snapshot.status === 'completed' ||
          snapshot.status === 'failed' ||
          snapshot.status === 'cancelled'
        ) {
          stop();
          if (!res.writableEnded) res.end();
        }
      } catch (error) {
        send({
          type: 'error',
          message: error instanceof Error ? error.message : 'Audit not found.',
        });
        stop();
        if (!res.writableEnded) res.end();
      }
    };

    res.on('close', () => {
      closed = true;
      stop();
    });

    interval = setInterval(tick, 500);
    tick();
  }

  @Get(':id/results')
  @Throttle({ default: { limit: 60, ttl: 60000 } })
  results(@Param('id') id: string, @Query() query: ResultsQueryDto) {
    return this.brokenLinksService.getResults(id, query);
  }

  @Get(':id/results/:resultId')
  @Throttle({ default: { limit: 60, ttl: 60000 } })
  resultDetail(@Param('id') id: string, @Param('resultId') resultId: string) {
    return this.brokenLinksService.getResultDetail(id, resultId);
  }

  @Get(':id/export')
  @Throttle({ default: { limit: 10, ttl: 60000 } })
  export(
    @Param('id') id: string,
    @Query() query: ResultsQueryDto,
    @Res() res: Response,
  ): void {
    let rows: AuditResultRow[];
    try {
      rows = this.brokenLinksService.getExportRows(id, query);
    } catch {
      res
        .status(HttpStatus.NOT_FOUND)
        .json({ message: 'Broken link audit not found.' });
      return;
    }

    const headers = [
      'Source Page',
      'Destination URL',
      'Anchor Text',
      'Link Type',
      'HTTP Status',
      'Issue Type',
      'Final URL',
      'Redirect Chain',
      'Error Details',
    ];
    const reportRows = rows.map((row) => ({
      'Source Page': row.sourcePage,
      'Destination URL': row.destinationUrl,
      'Anchor Text': row.anchorText,
      'Link Type': row.linkType,
      'HTTP Status': row.status ?? '-',
      'Issue Type': row.issueType,
      'Final URL': row.finalUrl || '-',
      'Redirect Chain': row.redirectChain
        .map(
          (hop) =>
            `${hop.url} [${hop.status}]${hop.location ? ` -> ${hop.location}` : ''}`,
        )
        .join(' | '),
      'Error Details': row.error || '-',
    }));

    const worksheet = XLSX.utils.json_to_sheet(reportRows, { header: headers });
    worksheet['!cols'] = [
      { wch: 55 },
      { wch: 55 },
      { wch: 30 },
      { wch: 12 },
      { wch: 12 },
      { wch: 22 },
      { wch: 55 },
      { wch: 60 },
      { wch: 45 },
    ];

    const workbook = XLSX.utils.book_new();
    XLSX.utils.book_append_sheet(workbook, worksheet, 'Broken Links');
    const buffer = XLSX.write(workbook, {
      type: 'buffer',
      bookType: 'xlsx',
    }) as Buffer;

    res.setHeader(
      'Content-Type',
      'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet',
    );
    res.setHeader(
      'Content-Disposition',
      `attachment; filename="broken-links-${id}.xlsx"`,
    );
    res.setHeader('Cache-Control', 'no-store');
    res.send(buffer);
  }

  @Post(':id/cancel')
  @Throttle({ default: { limit: 10, ttl: 60000 } })
  cancel(@Param('id') id: string): AuditSnapshot {
    this.logger.log(`Cancel requested for broken link audit: ${id}`);
    return this.brokenLinksService.cancelAudit(id);
  }

  @Get(':id')
  @Throttle({ default: { limit: 60, ttl: 60000 } })
  status(@Param('id') id: string): AuditSnapshot {
    return this.brokenLinksService.getSnapshot(id);
  }
}
