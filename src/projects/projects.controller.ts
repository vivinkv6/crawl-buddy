import { Controller, Get, Post, Body, Param, Render, Res, HttpStatus, Sse, BadRequestException, Query } from '@nestjs/common';
import { ProjectsService } from './projects.service';
import type { Response } from 'express';
import { Observable } from 'rxjs';
import axios from 'axios';
import { CreateProjectDto } from './dto/create-project.dto';
import { Throttle } from '@nestjs/throttler';

@Controller('projects')
export class ProjectsController {
  constructor(private readonly projectsService: ProjectsService) {}

  @Post()
  @Throttle({ default: { limit: 5, ttl: 60000 } })
  async create(@Body() body: CreateProjectDto, @Res() res: Response) {
    const oldUrl = body.oldSiteUrl;
    const newUrl = body.newSiteUrl;
    const sitemapUrl = body.sitemapUrl;

    // Check if domains are same
    try {
        const oldDomain = new URL(oldUrl).hostname.replace(/^www\./, '');
        const newDomain = new URL(newUrl).hostname.replace(/^www\./, '');
        
        if (oldDomain === newDomain) {
             return res.status(HttpStatus.BAD_REQUEST).json({ message: `Old and New sites cannot be the same domain (${oldDomain}). Please use different environments (e.g., production vs staging).` });
        }
    } catch (e) {
        return res.status(HttpStatus.BAD_REQUEST).json({ message: 'Invalid URL format provided.' });
    }

    // Validate URLs before creation
    if (!await this.isValidUrl(oldUrl)) {
        return res.status(HttpStatus.BAD_REQUEST).json({ message: `Old Site URL is unreachable: ${oldUrl}` });
    }
    if (!await this.isValidUrl(newUrl)) {
        return res.status(HttpStatus.BAD_REQUEST).json({ message: `New Site URL is unreachable: ${newUrl}` });
    }

    const project = await this.projectsService.createProject(oldUrl, newUrl, sitemapUrl);
    // If request accepts JSON, return JSON instead of redirect
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
          // Fallback to GET if HEAD fails (some servers block HEAD)
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
    const project = await this.projectsService.getProject(id);
    return { project };
  }

  @Post(':id/analyze')
  @Throttle({ default: { limit: 5, ttl: 60000 } })
  async analyze(@Param('id') id: string, @Res() res: Response) {
      try {
        const report = await this.projectsService.runComparison(id);
        return res.status(HttpStatus.OK).json(report);
      } catch (error) {
          return res.status(HttpStatus.INTERNAL_SERVER_ERROR).json({ message: error.message });
      }
  }

  @Sse(':id/stream')
  @Throttle({ default: { limit: 30, ttl: 60000 } })
  stream(@Param('id') id: string): Observable<MessageEvent> {
    return this.projectsService.streamComparison(id);
  }

  @Get(':id/export')
  @Throttle({ default: { limit: 30, ttl: 60000 } })
  async export(@Param('id') id: string, @Query('filter') filter: string, @Res() res: Response) {
    const report = await this.projectsService.runComparison(id);
    const buffer = this.projectsService.exportToExcel(report, filter);
    
    res.set({
      'Content-Type': 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet',
      'Content-Disposition': `attachment; filename="crawlbuddy_report_${id}_${filter || 'all'}.xlsx"`,
      'Content-Length': buffer.length,
    });
    // Send buffer directly without specifying encoding to let Buffer handling work naturally
    res.end(buffer);
  }
}
