import { Injectable, Logger } from '@nestjs/common';
import * as fs from 'fs';
import * as path from 'path';
import archiver from 'archiver';
import { v4 as uuidv4 } from 'uuid';
import * as XLSX from 'xlsx';
import axios from 'axios';

@Injectable()
export class DownloadService {
  private readonly logger = new Logger(DownloadService.name);

  private ensureDirectoryExists(dirPath: string) {
    try {
      if (!fs.existsSync(dirPath)) fs.mkdirSync(dirPath, { recursive: true });
    } catch (error) {
      this.logger.error(`Error ensuring directory exists: ${dirPath}`, error);
    }
  }

  private resolveImageUrl(url: string, baseUrl: string): string | null {
    try {
      if (!url) return null;
      if (url.startsWith('http://') || url.startsWith('https://')) return url;
      if (url.startsWith('//')) return 'https:' + url;
      try {
        let decodedUrl = decodeURIComponent(url);
        const urlParams = new URLSearchParams(decodedUrl);
        if (urlParams.has('url')) decodedUrl = decodeURIComponent(urlParams.get('url')!);
        return new URL(decodedUrl, baseUrl).href;
      } catch {
        return null;
      }
    } catch {
      return null;
    }
  }

  private cleanupUploads(dirPath?: string) {
    try {
      const uploadsDir = dirPath || path.join(process.cwd(), 'uploads');
      if (!fs.existsSync(uploadsDir)) return;
      const files = fs.readdirSync(uploadsDir);
      files.forEach(file => {
        const filePath = path.join(uploadsDir, file);
        try {
          if (fs.lstatSync(filePath).isDirectory()) {
            fs.rmSync(filePath, { recursive: true, force: true });
          } else {
            fs.unlinkSync(filePath);
          }
        } catch (err) {
          this.logger.error(`Error removing ${filePath}: ${err.message}`);
        }
      });
      if (fs.readdirSync(uploadsDir).length === 0) {
        fs.rmdirSync(uploadsDir);
        fs.mkdirSync(uploadsDir);
      }
    } catch (error) {
      this.logger.error(`Error cleaning up uploads directory: ${error.message}`);
    }
  }

  async processDownload(
    data: any,
    contentType: string,
    scrapeScope: string,
    format: string[] = ['json', 'xlsx'],
  ): Promise<{ filePath: string; fileName: string; cleanup: () => void }> {
    const sessionId = uuidv4();
    const uploadsDir = path.join(process.cwd(), 'uploads', sessionId);
    const archive = archiver('zip', { zlib: { level: 9 } });

    try {
      if (scrapeScope === 'single' && data.error) throw new Error(data.error);
      if (scrapeScope !== 'single' && data.pages) {
        const allErrors = data.pages.every((page: any) => page.error);
        if (allErrors) throw new Error('Failed to scrape any valid content from the website');
      }

      this.ensureDirectoryExists(uploadsDir);

      const pages = scrapeScope === 'single' ? [data] : data.pages;

      // Handle Excel format
      if (format.includes('xlsx')) {
        const workbook = XLSX.utils.book_new();

        if (contentType === 'all' || contentType === 'meta') {
          const metaHeaders = new Set(['url']);
          pages.forEach((page: any) => {
            if (page.meta) {
              page.meta.forEach((meta: any) => {
                if (meta.name) metaHeaders.add(`meta_${meta.name}`);
                if (meta.property) metaHeaders.add(`og_${meta.property.replace('og:', '')}`);
              });
            }
          });
          const metaData = pages.map((page: any) => {
            const row: any = { url: page.url };
            if (page.meta) {
              page.meta.forEach((meta: any) => {
                if (meta.name) row[`meta_${meta.name}`] = meta.content;
                if (meta.property) row[`og_${meta.property.replace('og:', '')}`] = meta.content;
              });
            }
            return row;
          });
          const metaSheet = XLSX.utils.json_to_sheet(metaData, { header: Array.from(metaHeaders) as string[] });
          XLSX.utils.book_append_sheet(workbook, metaSheet, 'Meta');
        }

        if (contentType === 'all' || contentType === 'images') {
          const imageData = pages.flatMap((page: any) =>
            (page.images || []).map((img: string) => ({ pageUrl: page.url, imageUrl: img })),
          );
          XLSX.utils.book_append_sheet(workbook, XLSX.utils.json_to_sheet(imageData), 'Images');
        }

        if (contentType === 'all' || contentType === 'videos') {
          const videoData = pages.flatMap((page: any) =>
            (page.videos || []).map((video: string) => ({ pageUrl: page.url, videoUrl: video })),
          );
          XLSX.utils.book_append_sheet(workbook, XLSX.utils.json_to_sheet(videoData), 'Videos');
        }

        if (contentType === 'all' || contentType === 'documents') {
          const docData = pages.flatMap((page: any) =>
            (page.documents || []).map((doc: string) => ({ pageUrl: page.url, documentUrl: doc })),
          );
          XLSX.utils.book_append_sheet(workbook, XLSX.utils.json_to_sheet(docData), 'Documents');
        }

        if (contentType === 'all' || contentType === 'social') {
          const socialData = pages.flatMap((page: any) =>
            (page.socialMedia || []).map((social: string) => {
              const platform = social.includes('facebook.com') ? 'Facebook' :
                social.includes('twitter.com') || social.includes('x.com') ? 'Twitter' :
                social.includes('instagram.com') ? 'Instagram' :
                social.includes('linkedin.com') ? 'LinkedIn' :
                social.includes('youtube.com') ? 'YouTube' :
                social.includes('pinterest.com') ? 'Pinterest' :
                social.includes('tiktok.com') ? 'TikTok' :
                social.includes('github') ? 'GitHub' : 'Other';
              return { 'Source Page': page.url, 'Platform': platform, 'Social Media URL': social };
            }),
          );
          XLSX.utils.book_append_sheet(workbook, XLSX.utils.json_to_sheet(socialData), 'Social Media');
        }

        if (contentType === 'all' || contentType === 'links') {
          const linkData = pages.flatMap((page: any) =>
            (page.links || []).map((link: string) => ({
              'Source Page': page.url,
              'Link URL': link,
              'Link Type': link.startsWith('http') ? 'External' : 'Internal',
            })),
          );
          XLSX.utils.book_append_sheet(workbook, XLSX.utils.json_to_sheet(linkData), 'Links');
        }

        if (contentType === 'all' || contentType === 'contact') {
          const contactData = pages.map((page: any) => ({ pageUrl: page.url, ...page.contacts }));
          XLSX.utils.book_append_sheet(workbook, XLSX.utils.json_to_sheet(contactData), 'Contacts');
        }

        const excelPath = path.join(uploadsDir, 'scraped_data.xlsx');
        XLSX.writeFile(workbook, excelPath);
        archive.file(excelPath, { name: 'scraped_data.xlsx' });

        if (!format.includes('json')) {
          return {
            filePath: excelPath,
            fileName: 'scraped_data.xlsx',
            cleanup: () => this.cleanupUploads(uploadsDir),
          };
        }
      }

      // Handle JSON/ZIP format
      const processedData: any[] = [];
      const zipPath = path.join(uploadsDir, 'scraped_data.zip');
      const output = fs.createWriteStream(zipPath);

      archive.on('error', (err: Error) => { throw err; });
      archive.pipe(output);

      for (let i = 0; i < pages.length; i++) {
        const page = pages[i];
        if (page.error) {
          processedData.push({ url: page.url, error: page.error });
          continue;
        }

        const metadata: any = {
          url: page.url,
          timestamp: new Date().toISOString(),
          failedImageDownloads: [],
        };

        if (contentType === 'all' || contentType === 'meta') metadata.meta = page.meta;

        if ((contentType === 'all' || contentType === 'images') && page.images?.length > 0) {
          const pageDir = path.join(uploadsDir, new URL(page.url).hostname.replace(/[^a-zA-Z0-9]/g, '_'));
          this.ensureDirectoryExists(pageDir);
          metadata.images = [];

          for (const imageUrl of page.images) {
            try {
              const resolvedUrl = this.resolveImageUrl(imageUrl, page.url);
              if (!resolvedUrl) {
                metadata.failedImageDownloads.push({ url: imageUrl, error: 'Invalid URL format' });
                continue;
              }
              const response = await axios({ method: 'get', url: resolvedUrl, responseType: 'stream' });
              let fileName = path.basename(resolvedUrl);
              const extMatch = fileName.match(/\.(jpg|jpeg|png|gif|bmp|webp|svg)($|\?|#)/i);
              const ext = extMatch ? extMatch[1].toLowerCase() : 'jpg';
              fileName = fileName.split('.')[0] + '.' + ext;

              let uniqueFileName = fileName;
              let counter = 1;
              while (fs.existsSync(path.join(pageDir, uniqueFileName))) {
                const nameWithoutExt = fileName.substring(0, fileName.lastIndexOf('.'));
                uniqueFileName = `${nameWithoutExt}_${counter}.${ext}`;
                counter++;
              }
              const filePath = path.join(pageDir, uniqueFileName);
              const fileStream = fs.createWriteStream(filePath);
              response.data.pipe(fileStream);
              await new Promise<void>((resolve, reject) => {
                fileStream.on('finish', resolve);
                fileStream.on('error', reject);
              });
              archive.file(filePath, { name: `${new URL(page.url).hostname}/${fileName}` });
              metadata.images.push({ url: resolvedUrl, fileName });
            } catch (error) {
              metadata.failedImageDownloads.push({ url: imageUrl, error: error.message });
            }
          }
        }

        if ((contentType === 'all' || contentType === 'videos') && page.videos) metadata.videos = page.videos;
        if ((contentType === 'all' || contentType === 'documents') && page.documents) metadata.documents = page.documents;
        if ((contentType === 'all' || contentType === 'social') && page.socialMedia) metadata.socialMedia = page.socialMedia;
        if ((contentType === 'all' || contentType === 'links') && page.links) metadata.links = page.links;
        if (contentType === 'all' && page.contacts) metadata.contacts = page.contacts;

        processedData.push(metadata);
      }

      const metadataContent = JSON.stringify(
        scrapeScope === 'single' ? processedData[0] : { pages: processedData },
        null, 2,
      );
      archive.append(metadataContent, { name: 'metadata.json' });

      await archive.finalize();
      await new Promise<void>((resolve, reject) => {
        output.on('close', resolve);
        output.on('error', reject);
      });

      return {
        filePath: zipPath,
        fileName: 'scraped_data.zip',
        cleanup: () => this.cleanupUploads(uploadsDir),
      };
    } catch (error) {
      this.cleanupUploads(uploadsDir);
      throw error;
    }
  }

  async downloadMedia(mediaFiles: { type: string; url: string; pageUrl: string }[]): Promise<{ filePath: string; fileName: string; cleanup: () => void }> {
    const sessionId = uuidv4();
    const uploadsDir = path.join(process.cwd(), 'uploads', sessionId);
    const archive = archiver('zip', { zlib: { level: 9 } });

    try {
      this.ensureDirectoryExists(uploadsDir);
      
      const zipPath = path.join(uploadsDir, 'media.zip');
      const output = fs.createWriteStream(zipPath);
      archive.on('error', (err: Error) => { throw err; });
      archive.pipe(output);

      for (const media of mediaFiles) {
        try {
          const resolvedUrl = this.resolveImageUrl(media.url, media.pageUrl);
          if (!resolvedUrl) continue;

          const pageDir = path.join(uploadsDir, new URL(media.pageUrl).hostname.replace(/[^a-zA-Z0-9]/g, '_'));
          this.ensureDirectoryExists(pageDir);

          let ext = 'bin';
          let folderName = 'other';
          
          if (media.type === 'video') {
            folderName = 'videos';
            if (media.url.includes('.webm')) ext = 'webm';
            else if (media.url.includes('.ogg')) ext = 'ogg';
            else if (media.url.includes('.mov')) ext = 'mov';
            else if (media.url.includes('.avi')) ext = 'avi';
            else ext = 'mp4';
          } else if (media.type === 'image') {
            folderName = 'images';
            const extMatch = media.url.match(/\.(jpg|jpeg|png|gif|bmp|webp|svg|ico|avif)($|\?|#)/i);
            if (extMatch) ext = extMatch[1].toLowerCase();
            else ext = 'jpg';
          } else if (media.type === 'document' || media.type === 'pdf') {
            folderName = 'documents';
            if (media.url.includes('.pdf')) ext = 'pdf';
            else if (media.url.includes('.doc')) ext = 'doc';
            else if (media.url.includes('.docx')) ext = 'docx';
            else if (media.url.includes('.xls')) ext = 'xls';
            else if (media.url.includes('.xlsx')) ext = 'xlsx';
            else if (media.url.includes('.ppt')) ext = 'ppt';
            else if (media.url.includes('.pptx')) ext = 'pptx';
            else if (media.url.includes('.txt')) ext = 'txt';
            else if (media.url.includes('.csv')) ext = 'csv';
          } else if (media.type === 'audio') {
            folderName = 'audio';
            if (media.url.includes('.mp3')) ext = 'mp3';
            else if (media.url.includes('.wav')) ext = 'wav';
            else if (media.url.includes('.ogg')) ext = 'ogg';
            else if (media.url.includes('.m4a')) ext = 'm4a';
          }

          const fileName = `${media.type}_${Date.now()}_${Math.random().toString(36).substr(2, 9)}.${ext}`;
          const filePath = path.join(pageDir, fileName);

          const response = await axios({ method: 'get', url: resolvedUrl, responseType: 'stream', timeout: 30000 });
          const fileStream = fs.createWriteStream(filePath);
          response.data.pipe(fileStream);
          await new Promise<void>((resolve, reject) => {
            fileStream.on('finish', resolve);
            fileStream.on('error', reject);
          });

          const archivePath = `${new URL(media.pageUrl).hostname}/${folderName}/${fileName}`;
          archive.file(filePath, { name: archivePath });
        } catch (error) {
          this.logger.error(`Failed to download media: ${media.url}`, error.message);
        }
      }

      await archive.finalize();
      await new Promise<void>((resolve, reject) => {
        output.on('close', resolve);
        output.on('error', reject);
      });

      return {
        filePath: zipPath,
        fileName: 'media.zip',
        cleanup: () => this.cleanupUploads(uploadsDir),
      };
    } catch (error) {
      this.cleanupUploads(uploadsDir);
      throw error;
    }
  }

  async downloadMediaWithProgress(
    mediaFiles: { type: string; url: string; pageUrl: string }[],
    onProgress: (progress: { current: number; total: number; fileName: string; percentage: number }) => void,
  ): Promise<{ filePath: string; fileName: string; cleanup: () => void }> {
    const sessionId = uuidv4();
    const uploadsDir = path.join(process.cwd(), 'uploads', sessionId);
    const archive = archiver('zip', { zlib: { level: 9 } });

    const totalFiles = mediaFiles.length;
    let downloadedCount = 0;
    let failedCount = 0;

    try {
      this.ensureDirectoryExists(uploadsDir);
      
      const zipPath = path.join(uploadsDir, 'media.zip');
      const output = fs.createWriteStream(zipPath);
      archive.on('error', (err: Error) => { throw err; });
      archive.pipe(output);

      for (let i = 0; i < mediaFiles.length; i++) {
        const media = mediaFiles[i];
        const fileName = media.url.split('/').pop() || 'file';
        
        onProgress({
          current: downloadedCount + failedCount,
          total: totalFiles,
          fileName: fileName,
          percentage: Math.round(((downloadedCount + failedCount) / totalFiles) * 100)
        });

        try {
          const resolvedUrl = this.resolveImageUrl(media.url, media.pageUrl);
          if (!resolvedUrl) {
            failedCount++;
            continue;
          }

          const pageDir = path.join(uploadsDir, new URL(media.pageUrl).hostname.replace(/[^a-zA-Z0-9]/g, '_'));
          this.ensureDirectoryExists(pageDir);

          let ext = 'bin';
          let folderName = 'other';
          
          if (media.type === 'video') {
            folderName = 'videos';
            if (media.url.includes('.webm')) ext = 'webm';
            else if (media.url.includes('.mov')) ext = 'mov';
            else if (media.url.includes('.avi')) ext = 'avi';
            else ext = 'mp4';
          } else if (media.type === 'image') {
            folderName = 'images';
            const extMatch = media.url.match(/\.(jpg|jpeg|png|gif|bmp|webp|svg|ico|avif)($|\?|#)/i);
            if (extMatch) ext = extMatch[1].toLowerCase();
            else ext = 'jpg';
          } else if (media.type === 'pdf' || media.type === 'document') {
            folderName = 'documents';
            if (media.url.includes('.pdf')) ext = 'pdf';
            else if (media.url.includes('.doc')) ext = 'doc';
            else if (media.url.includes('.docx')) ext = 'docx';
            else if (media.url.includes('.xls')) ext = 'xls';
            else if (media.url.includes('.xlsx')) ext = 'xlsx';
            else if (media.url.includes('.ppt')) ext = 'ppt';
            else if (media.url.includes('.pptx')) ext = 'pptx';
            else if (media.url.includes('.txt')) ext = 'txt';
            else if (media.url.includes('.csv')) ext = 'csv';
          } else if (media.type === 'audio') {
            folderName = 'audio';
            if (media.url.includes('.mp3')) ext = 'mp3';
            else if (media.url.includes('.wav')) ext = 'wav';
            else if (media.url.includes('.ogg')) ext = 'ogg';
            else if (media.url.includes('.m4a')) ext = 'm4a';
          }

          const uniqueFileName = `${media.type}_${Date.now()}_${Math.random().toString(36).substr(2, 9)}.${ext}`;
          const filePath = path.join(pageDir, uniqueFileName);

          const response = await axios({ method: 'get', url: resolvedUrl, responseType: 'stream', timeout: 30000 });
          const fileStream = fs.createWriteStream(filePath);
          response.data.pipe(fileStream);
          await new Promise<void>((resolve, reject) => {
            fileStream.on('finish', resolve);
            fileStream.on('error', reject);
          });

          const archivePath = `${new URL(media.pageUrl).hostname}/${folderName}/${uniqueFileName}`;
          archive.file(filePath, { name: archivePath });
          downloadedCount++;
        } catch (error) {
          this.logger.error(`Failed to download media: ${media.url}`, error.message);
          failedCount++;
        }

        onProgress({
          current: downloadedCount + failedCount,
          total: totalFiles,
          fileName: fileName,
          percentage: Math.round(((downloadedCount + failedCount) / totalFiles) * 100)
        });
      }

      onProgress({
        current: totalFiles,
        total: totalFiles,
        fileName: 'Finalizing...',
        percentage: 95
      });

      await archive.finalize();
      await new Promise<void>((resolve, reject) => {
        output.on('close', resolve);
        output.on('error', reject);
      });

      return {
        filePath: zipPath,
        fileName: 'scraped-media.zip',
        cleanup: () => this.cleanupUploads(uploadsDir),
      };
    } catch (error) {
      this.cleanupUploads(uploadsDir);
      throw error;
    }
  }
}
