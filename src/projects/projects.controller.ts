import {
  Controller,
  Get,
  Post,
  Body,
  Param,
  Render,
  Res,
  HttpStatus,
  Query,
  Logger,
} from '@nestjs/common';
import { ProjectsService } from './projects.service';
import type { Response } from 'express';
import axios from 'axios';
import { CreateProjectDto } from './dto/create-project.dto';
import { Throttle } from '@nestjs/throttler';

@Controller('projects')
export class ProjectsController {
  private readonly logger = new Logger(ProjectsController.name);

  constructor(private readonly projectsService: ProjectsService) {}

  @Post()
  @Throttle({ default: { limit: 5, ttl: 60000 } })
  async create(@Body() body: CreateProjectDto, @Res() res: Response) {
    this.logger.log(
      `Creating project: oldSiteUrl=${body.oldSiteUrl}, newSiteUrl=${body.newSiteUrl}, sitemapUrl=${body.sitemapUrl}`,
    );

    const oldUrl = body.oldSiteUrl;
    const newUrl = body.newSiteUrl;
    const sitemapUrl = body.sitemapUrl;

    try {
      const oldDomain = new URL(oldUrl).hostname.replace(/^www\./, '');
      const newDomain = new URL(newUrl).hostname.replace(/^www\./, '');

      if (oldDomain === newDomain) {
        this.logger.warn(`Same domain detected: ${oldDomain}`);
        return res.status(HttpStatus.BAD_REQUEST).json({
          message: `Old and New sites cannot be the same domain (${oldDomain}). Please use different environments (e.g., production vs staging).`,
        });
      }
    } catch (e) {
      this.logger.warn(`Invalid URL format: ${e.message}`);
      return res
        .status(HttpStatus.BAD_REQUEST)
        .json({ message: 'Invalid URL format provided.' });
    }

    if (!(await this.isValidUrl(oldUrl))) {
      this.logger.warn(`Old Site URL unreachable: ${oldUrl}`);
      return res
        .status(HttpStatus.BAD_REQUEST)
        .json({ message: `Old Site URL is unreachable: ${oldUrl}` });
    }
    if (!(await this.isValidUrl(newUrl))) {
      this.logger.warn(`New Site URL unreachable: ${newUrl}`);
      return res
        .status(HttpStatus.BAD_REQUEST)
        .json({ message: `New Site URL is unreachable: ${newUrl}` });
    }

    const project = await this.projectsService.createProject(
      oldUrl,
      newUrl,
      sitemapUrl,
    );
    this.logger.log(`Project created successfully: ${project.id}`);

    if (res.req.headers['accept']?.includes('application/json')) {
      return res.json({ id: project.id });
    }
    return res.redirect(`/projects/${project.id}`);
  }

  private async isValidUrl(url: string): Promise<boolean> {
    try {
      await axios.head(url, { timeout: 5000, validateStatus: () => true });
      return true;
    } catch (error) {
      try {
        await axios.get(url, { timeout: 5000, validateStatus: () => true });
        return true;
      } catch (e) {
        return false;
      }
    }
  }

  @Get(':id')
  @Throttle({ default: { limit: 30, ttl: 60000 } })
  @Render('project')
  async findOne(@Param('id') id: string) {
    this.logger.log(`Finding project: ${id}`);
    const project = await this.projectsService.getProject(id);
    return { project };
  }

  @Post(':id/analyze')
  @Throttle({ default: { limit: 5, ttl: 60000 } })
  async analyze(@Param('id') id: string, @Res() res: Response) {
    this.logger.log(`Analyzing project: ${id}`);
    try {
      const report = await this.projectsService.runComparison(id);
      this.logger.log(`Analysis completed for project: ${id}`);
      return res.status(HttpStatus.OK).json(report);
    } catch (error) {
      this.logger.error(`Analysis failed for project ${id}: ${error.message}`);
      return res
        .status(HttpStatus.INTERNAL_SERVER_ERROR)
        .json({ message: error.message });
    }
  }

  @Post(':id/stop')
  @Throttle({ default: { limit: 10, ttl: 60000 } })
  async stop(@Param('id') id: string, @Res() res: Response) {
    this.logger.log(`Stopping project stream for: ${id}`);
    this.projectsService.stopComparison(id);
    return res.status(HttpStatus.OK).json({ stopped: true });
  }

  @Get(':id/stream')
  @Throttle({ default: { limit: 30, ttl: 60000 } })
  async stream(@Param('id') id: string, @Res() res: Response) {
    this.logger.log(`Starting SSE stream for project: ${id}`);

    res.setHeader('Content-Type', 'text/event-stream');
    res.setHeader('Cache-Control', 'no-cache');
    res.setHeader('Connection', 'keep-alive');
    res.setHeader('X-Accel-Buffering', 'no');

    const sendEvent = (data: any) => {
      res.write(`data: ${JSON.stringify(data)}\n\n`);
    };

    let streamClosed = false;
    res.on('close', () => {
      if (streamClosed) return;
      streamClosed = true;
      this.logger.log(`SSE client disconnected for project: ${id}`);
      this.projectsService.stopComparison(id);
    });

    try {
      const project = await this.projectsService.getProject(id);
      this.logger.log(
        `Project found: ${id}, oldSite: ${project.oldSiteUrl}, newSite: ${project.newSiteUrl}`,
      );

      await this.projectsService.streamComparisonWithCallback(id, (message) => {
        sendEvent(message);
      });

      if (!streamClosed) {
        sendEvent({ type: 'complete' });
      }
      this.logger.log(`SSE stream completed for project: ${id}`);
      res.end();
    } catch (error) {
      this.logger.error(
        `SSE stream error for project ${id}: ${error.message}`,
        error.stack,
      );
      sendEvent({ type: 'error', message: error.message });
      res.end();
    }
  }

  @Get(':id/export')
  @Throttle({ default: { limit: 30, ttl: 60000 } })
  async export(
    @Param('id') id: string,
    @Query('filter') filter: string,
    @Res() res: Response,
  ) {
    this.logger.log(`Exporting report for project: ${id}, filter: ${filter}`);
    const report = await this.projectsService.runComparison(id);
    const exportFile = await this.projectsService.exportToExcel(report, filter);

    res.download(exportFile.filePath, exportFile.fileName, (err) => {
      if (err) {
        this.logger.error(`Export failed for project ${id}: ${err.message}`);
      } else {
        this.logger.log(`Export completed for project: ${id}`);
      }
      exportFile.cleanup();
    });
  }
}
