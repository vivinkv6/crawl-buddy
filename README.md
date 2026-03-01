# Crawl Buddy

## Your All-in-One SEO & Web Scraping Toolkit

Crawl Buddy is a comprehensive SEO tool that helps you with website migrations, content scraping, and URL extraction. It provides real-time streaming results and easy export options.

---

## Tools Overview

### 1. Migration Checker
**Your Safety Net for Website Migrations**

Moving to a new website shouldn't mean losing your hard-earned search rankings. Crawl Buddy acts as your personal migration assistant, automatically checking every page on your old site against your new one.

**Features:**
- **Smart Comparison**: Instantly compares your old and new sites side-by-side
- **Sitemap Integration**: Supports crawling via Sitemap XML (including nested sitemaps)
- **Deep SEO Analysis**: Checks Keywords, Schema Markup, H1 Tags, Titles, and Descriptions
- **Redirect Intelligence**: Verifies if old links correctly redirect to the new site (301s)
- **Error Spotting**: Finds broken links (404s) and missing pages automatically
- **Detailed Reports**: Download audit reports in Excel format with filtered views

---

### 2. Website Scraper
**Extract Content from Any Website**

A powerful web scraping tool that lets you extract various types of content from websites in real-time.

**Features:**
- **Flexible Scraping**: Scrape single pages or entire websites via sitemap
- **Content Types**: Extract Meta Tags, Images, Videos, Links, Documents, Social Media, and Contact Info
- **Real-Time Streaming**: See results as they're scraped, with progress updates
- **Server-Sent Events**: Live streaming of scraped data for immediate feedback
- **Export Options**: Download scraped data in JSON or Excel format

**Use Cases:**
- Competitor research
- Content aggregation
- Price monitoring
- Data collection for analysis

---

### 3. Website URL Extractor
**Extract All Indexed URLs from Any Sitemap**

Quickly extract all URLs from a website's sitemap for analysis or export.

**Features:**
- **Sitemap Parsing**: Fetches and parses XML sitemaps automatically
- **Nested Sitemap Support**: Handles sitemap indexes with multiple nested sitemaps
- **Real-Time Extraction**: URLs appear as they're discovered
- **Progress Tracking**: See extraction progress with count display
- **Excel Export**: Export all URLs to a spreadsheet for further analysis

**Use Cases:**
- SEO audits
- URL inventory
- Sitemap validation
- Link analysis

---

## Technical Overview

### Real-Time Streaming
All tools use Server-Sent Events (SSE) to stream results instantly, providing immediate feedback without waiting for operations to complete.

### SEO Analysis (Migration Checker)
- **Status Codes**: Identifies 404 errors, 500 server errors, and verifies 301 redirects
- **Meta Tag Validation**: Compares Title tags, Meta Descriptions, Keywords, and H1 headers
- **Social Media Validation**: Checks Open Graph (OG) Title, Description, and Image tags
- **Schema Markup**: Detects and compares structured data (JSON-LD) types
- **Canonical Analysis**: Detects mismatches in canonical tags
- **Orphan Page Detection**: Finds new pages on the destination site

### Interactive Dashboard
- Visual summary cards for quick insights
- Filterable results tables
- Dark/Light mode support

---

## Technologies Used

### Backend
- **NestJS**: Progressive Node.js framework for building efficient server-side applications
- **TypeScript**: Typed superset of JavaScript for safer code
- **Prisma**: ORM for interacting with PostgreSQL database
- **PostgreSQL**: Open-source relational database
- **RxJS**: Reactive programming with Observables for streaming
- **Cheerio**: Server-side HTML parsing
- **Axios**: HTTP client for external requests
- **SheetJS (xlsx)**: Excel file generation

### Frontend
- **EJS**: JavaScript templating for HTML generation
- **Bootstrap 5**: Responsive frontend framework
- **Server-Sent Events (SSE)**: Real-time updates from server to client
