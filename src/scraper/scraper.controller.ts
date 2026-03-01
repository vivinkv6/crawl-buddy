import { Controller, Get, Post, Body, Render, Res, HttpStatus, Query } from '@nestjs/common';
import { ScraperService } from './scraper.service';
import { DownloadService } from './download.service';
import type { Response } from 'express';
import * as XLSX from 'xlsx';

@Controller('scraper')
export class ScraperController {
  constructor(
    private readonly scraperService: ScraperService,
    private readonly downloadService: DownloadService,
  ) {}

  @Get()
  @Render('scraper')
  scraperPage() {
    return {};
  }

  @Get('url-extractor')
  @Render('url-extractor')
  urlExtractorPage() {
    return {};
  }

  @Get('extract-urls')
  async extractUrls(@Query('sitemapUrl') sitemapUrl: string, @Res() res: Response) {
    res.setHeader('Content-Type', 'text/event-stream');
    res.setHeader('Cache-Control', 'no-cache');
    res.setHeader('Connection', 'keep-alive');
    res.setHeader('X-Accel-Buffering', 'no');

    if (!sitemapUrl) {
      res.write(`data: ${JSON.stringify({ type: 'error', message: 'Sitemap URL is required' })}\n\n`);
      res.end();
      return;
    }

    const sendEvent = (data: any) => {
      res.write(`data: ${JSON.stringify(data)}\n\n`);
    };

    const delay = (ms: number) => new Promise(resolve => setTimeout(resolve, ms));

    try {
      // First, fetch all URLs to get total count
      const urls = await this.scraperService.parseSitemap(sitemapUrl);
      const uniqueUrls = [...new Set(urls)];
      const totalUrls = uniqueUrls.length;

      if (totalUrls === 0) {
        sendEvent({ type: 'error', message: 'No URLs found in sitemap' });
        res.end();
        return;
      }

      // Send start event with total count
      sendEvent({ type: 'start', total: totalUrls });

      // Then stream each URL with a small delay
      for (let i = 0; i < uniqueUrls.length; i++) {
        sendEvent({ 
          type: 'result', 
          url: uniqueUrls[i],
          index: i + 1,
          total: totalUrls
        });
        await delay(5);
      }

      sendEvent({ type: 'complete', total: totalUrls });
      res.end();
    } catch (error) {
      sendEvent({ type: 'error', message: error.message });
      res.end();
    }
  }

  @Post('extract-urls/export')
  async exportUrls(@Body() body: any, @Res() res: Response) {
    try {
      const { urls } = body;

      if (!urls || !Array.isArray(urls) || urls.length === 0) {
        return res.status(HttpStatus.BAD_REQUEST).json({ error: 'No URLs to export' });
      }

      const workbook = XLSX.utils.book_new();
      const urlData = urls.map((url: string) => [url]);

      const sheet = XLSX.utils.aoa_to_sheet(urlData);
      XLSX.utils.book_append_sheet(workbook, sheet, 'URLs');

      const buffer = XLSX.write(workbook, { type: 'buffer', bookType: 'xlsx' });

      res.setHeader('Content-Disposition', 'attachment');
      res.setHeader('Content-Type', 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet');
      res.send(buffer);

    } catch (error) {
      return res.status(HttpStatus.INTERNAL_SERVER_ERROR).json({
        error: error.message || 'Failed to export URLs'
      });
    }
  }

  @Post('scrape')
  async scrape(@Body() body: any, @Res() res: Response) {
    try {
      const { url, contentType = 'all', scrapeScope = 'entire' } = body;

      if (!url) {
        return res.status(HttpStatus.BAD_REQUEST).json({ error: 'URL is required' });
      }

      if (scrapeScope === 'single') {
        try {
          new URL(url.startsWith('http') ? url : `https://${url}`);
        } catch {
          return res.status(HttpStatus.BAD_REQUEST).json({ error: 'Invalid URL format. Please provide a valid URL.' });
        }

        const websiteUrl = url.startsWith('http') ? url : `https://${url}`;
        const result = await this.scraperService.scrapePage(websiteUrl, contentType);
        return res.json(result);
      } else {
        let sitemapUrl = url;
        
        try {
          new URL(sitemapUrl);
        } catch {
          return res.status(HttpStatus.BAD_REQUEST).json({ error: 'Invalid sitemap URL format. Please provide a valid URL.' });
        }

        const pages = await this.scraperService.scrapeFromSitemap(sitemapUrl, contentType);
        return res.json({ pages });
      }
    } catch (error) {
      const errorResponse = {
        error: error.message,
        status: error.response?.status || 500,
        details: error.response?.statusText || 'An error occurred during scraping',
      };
      return res.status(errorResponse.status).json(errorResponse);
    }
  }

  @Post('download')
  async download(@Body() body: any, @Res() res: Response) {
    try {
      const { data, contentType, scrapeScope, format = ['json', 'xlsx'] } = body;
      const formatArray = Array.isArray(format) ? format : [format];

      const result = await this.downloadService.processDownload(data, contentType, scrapeScope, formatArray);

      res.download(result.filePath, result.fileName, (err) => {
        if (err) console.error('Error sending file:', err);
        result.cleanup();
      });
    } catch (error) {
      return res.status(HttpStatus.INTERNAL_SERVER_ERROR).json({
        type: 'error',
        error: error.message || 'Failed to process request',
        details: 'An error occurred while processing the scraped data.',
      });
    }
  }

  @Post('download-media')
  async downloadMedia(@Body() body: any, @Res() res: Response) {
    try {
      const { mediaFiles } = body;

      if (!mediaFiles || !Array.isArray(mediaFiles) || mediaFiles.length === 0) {
        return res.status(HttpStatus.BAD_REQUEST).json({ error: 'No media files to download' });
      }

      const result = await this.downloadService.downloadMedia(mediaFiles);

      res.download(result.filePath, result.fileName, (err) => {
        if (err) console.error('Error sending file:', err);
        result.cleanup();
      });
    } catch (error) {
      return res.status(HttpStatus.INTERNAL_SERVER_ERROR).json({
        type: 'error',
        error: error.message || 'Failed to download media',
        details: 'An error occurred while downloading media files.',
      });
    }
  }

  @Post('download-media/stream')
  async downloadMediaStream(@Body() body: any, @Res() res: Response) {
    res.setHeader('Content-Type', 'text/event-stream');
    res.setHeader('Cache-Control', 'no-cache');
    res.setHeader('Connection', 'keep-alive');
    res.setHeader('X-Accel-Buffering', 'no');

    const { mediaFiles } = body;

    if (!mediaFiles || !Array.isArray(mediaFiles) || mediaFiles.length === 0) {
      res.write(`data: ${JSON.stringify({ type: 'error', message: 'No media files to download' })}\n\n`);
      res.end();
      return;
    }

    const sendEvent = (data: any) => {
      res.write(`data: ${JSON.stringify(data)}\n\n`);
    };

    try {
      const result = await this.downloadService.downloadMediaWithProgress(mediaFiles, (progress) => {
        sendEvent({ type: 'progress', ...progress });
      });

      sendEvent({ type: 'complete', filePath: result.filePath, fileName: result.fileName });

      res.on('close', () => {
        result.cleanup();
      });
    } catch (error) {
      sendEvent({ type: 'error', message: error.message });
      res.end();
    }
  }

  @Post('scrape/stream')
  async streamScrape(@Body() body: any, @Res() res: Response) {
    res.setHeader('Content-Type', 'text/event-stream');
    res.setHeader('Cache-Control', 'no-cache');
    res.setHeader('Connection', 'keep-alive');
    res.setHeader('X-Accel-Buffering', 'no');

    const { url, contentType = 'all', scrapeScope = 'entire', maxPages = 10000 } = body;

    if (!url) {
      res.write(`data: ${JSON.stringify({ type: 'error', message: 'URL is required' })}\n\n`);
      res.end();
      return;
    }

    const sendEvent = (data: any) => {
      res.write(`data: ${JSON.stringify(data)}\n\n`);
    };

    try {
      const websiteUrl = url.startsWith('http') ? url : `https://${url}`;
      
      if (scrapeScope === 'single') {
        const result = await this.scraperService.scrapePage(websiteUrl, contentType);
        sendEvent({ type: 'result', page: result });
        sendEvent({ type: 'complete', totalPages: 1 });
        res.end();
      } else {
        let sitemapUrl = url;
        try {
          new URL(sitemapUrl);
        } catch {
          sendEvent({ type: 'error', message: 'Invalid sitemap URL format' });
          res.end();
          return;
        }

        const urls = await this.scraperService.parseSitemap(sitemapUrl);
        const uniqueUrls = [...new Set(urls)].slice(0, maxPages);
        
        if (uniqueUrls.length === 0) {
          sendEvent({ type: 'error', message: 'No URLs found in sitemap' });
          res.end();
          return;
        }

        const totalPages = uniqueUrls.length;
        
        sendEvent({ type: 'start', totalPages });

        const failedUrls = new Set<string>();

        for (let i = 0; i < uniqueUrls.length; i++) {
          const pageUrl = uniqueUrls[i];
          if (failedUrls.has(pageUrl)) continue;

          try {
            const pageData = await this.scraperService.scrapePage(pageUrl, contentType);
            sendEvent({ 
              type: 'result', 
              page: pageData,
              current: i + 1,
              total: totalPages 
            });
          } catch (error) {
            let errorMessage: string;
            if (error.response) {
              errorMessage = `Failed: ${error.response.status}`;
            } else if (error.request) {
              errorMessage = 'Network Error';
            } else {
              errorMessage = error.message?.split(':')[0] || 'Error';
            }
            failedUrls.add(pageUrl);
            sendEvent({ 
              type: 'result', 
              page: { url: pageUrl, error: errorMessage },
              current: i + 1,
              total: totalPages 
            });
          }
        }

        sendEvent({ type: 'complete', totalPages: uniqueUrls.length - failedUrls.size, failed: failedUrls.size });
        res.end();
      }
    } catch (error) {
      sendEvent({ type: 'error', message: error.message });
      res.end();
    }
  }

  @Get('scrape/stream')
  async streamScrapeGet(
    @Query('url') url: string,
    @Query('contentType') contentType: string = 'all',
    @Query('scrapeScope') scrapeScope: string = 'entire',
    @Query('maxPages') maxPages: string = '100',
    @Res() res?: Response
  ) {
    const maxPagesNum = parseInt(maxPages) || 10000;
    if (res) {
      return this.streamScrapeInternal({ url, contentType, scrapeScope, maxPages: maxPagesNum }, res);
    }
    return { error: 'Response object required' };
  }

  private async streamScrapeInternal(body: any, res: Response) {
    res.setHeader('Content-Type', 'text/event-stream');
    res.setHeader('Cache-Control', 'no-cache');
    res.setHeader('Connection', 'keep-alive');
    res.setHeader('X-Accel-Buffering', 'no');

    const { url, contentType = 'all', scrapeScope = 'entire', maxPages = 10000 } = body;

    if (!url) {
      res.write(`data: ${JSON.stringify({ type: 'error', message: 'URL is required' })}\n\n`);
      res.end();
      return;
    }

    const sendEvent = (data: any) => {
      res.write(`data: ${JSON.stringify(data)}\n\n`);
    };

    try {
      const websiteUrl = url.startsWith('http') ? url : `https://${url}`;
      
      if (scrapeScope === 'single') {
        const result = await this.scraperService.scrapePage(websiteUrl, contentType);
        sendEvent({ type: 'result', page: result });
        sendEvent({ type: 'complete', totalPages: 1 });
        res.end();
      } else {
        let sitemapUrl = url;
        try {
          new URL(sitemapUrl);
        } catch {
          sendEvent({ type: 'error', message: 'Invalid sitemap URL format' });
          res.end();
          return;
        }

        const urls = await this.scraperService.parseSitemap(sitemapUrl);
        const uniqueUrls = [...new Set(urls)].slice(0, maxPages);
        const totalPages = uniqueUrls.length;
        
        sendEvent({ type: 'start', totalPages });

        const failedUrls = new Set<string>();

        for (let i = 0; i < uniqueUrls.length; i++) {
          const pageUrl = uniqueUrls[i];
          if (failedUrls.has(pageUrl)) continue;

          try {
            const pageData = await this.scraperService.scrapePage(pageUrl, contentType);
            sendEvent({ 
              type: 'result', 
              page: pageData,
              current: i + 1,
              total: totalPages 
            });
          } catch (error) {
            let errorMessage: string;
            if (error.response) {
              errorMessage = `Failed: ${error.response.status}`;
            } else if (error.request) {
              errorMessage = 'Network Error';
            } else {
              errorMessage = error.message?.split(':')[0] || 'Error';
            }
            failedUrls.add(pageUrl);
            sendEvent({ 
              type: 'result', 
              page: { url: pageUrl, error: errorMessage },
              current: i + 1,
              total: totalPages 
            });
          }
        }

        sendEvent({ type: 'complete', totalPages: uniqueUrls.length - failedUrls.size, failed: failedUrls.size });
        res.end();
      }
    } catch (error) {
      sendEvent({ type: 'error', message: error.message });
      res.end();
    }
  }
}
