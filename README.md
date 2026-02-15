# Crawl Buddy

## Your Safety Net for Website Migrations

Moving to a new website shouldn't mean losing your hard-earned search rankings. Crawl Buddy acts as your personal migration assistant, automatically checking every page on your old site against your new one. It spots missing pages, broken links, and hidden errors instantly so you can fix them before your customers—or Google—ever notice.

### Key Features

*   **Smart Comparison**: Instantly compares your old and new sites side-by-side.
*   **Deep SEO Analysis**: Checks **Keywords**, **Schema Markup**, **H1 Tags**, **Titles**, and **Descriptions**.
*   **Redirect Intelligence**: Verifies if old links correctly redirect to the new site (301s).
*   **Error Spotting**: Finds broken links (404s) and missing pages automatically.
*   **Simple Reports**: Gives you clear, actionable lists of what needs fixing.

### Technical Overview

*   **Real-Time Comparison**: Streams crawl results instantly using Server-Sent Events (SSE), providing immediate feedback without waiting for the entire crawl to finish.
*   **Comprehensive SEO Checks**:
    *   **Status Codes**: Identifies 404 errors, 500 server errors, and verifies 301 redirects.
    *   **Meta Tag Validation**: Compares Title tags, Meta Descriptions, Keywords, and H1 headers.
    *   **Social Media Validation**: Checks Open Graph (OG) Title, Description, and Image tags for social sharing.
    *   **Schema Markup**: Detects and compares structured data (JSON-LD) types (e.g., FAQ, Organization).
    *   **Canonical Analysis**: Detects mismatches in canonical tags.
    *   **Orphan Page Detection**: Finds new pages on the destination site that don't exist on the source site.
*   **Interactive Dashboard**:
    *   Visual summary cards for quick insights (Total Scanned, Missing, New, Meta Issues).
    *   Filterable results table for focused analysis.
*   **Instant Reporting**:
    *   **In-Memory Caching**: Stores crawl results temporarily for instant report generation.
    *   **Excel Export**: Download detailed audit reports in `.xlsx` format with support for filtered views (e.g., download only "Missing" pages).

### Technologies Used

This project is built with a modern, robust technology stack:

#### Backend
*   **[NestJS](https://nestjs.com/)**: A progressive Node.js framework for building efficient, reliable, and scalable server-side applications.
*   **[TypeScript](https://www.typescriptlang.org/)**: Typed superset of JavaScript for safer and more maintainable code.
*   **[Prisma](https://www.prisma.io/)**: Next-generation ORM for Node.js and TypeScript, used for interacting with the PostgreSQL database.
*   **[PostgreSQL](https://www.postgresql.org/)**: Powerful, open-source object-relational database system.
*   **[RxJS](https://rxjs.dev/)**: Library for reactive programming using Observables, powering the real-time streaming functionality.
*   **[Cheerio](https://cheerio.js.org/)**: Fast, flexible, and lean implementation of core jQuery designed specifically for the server to parse HTML.
*   **[Axios](https://axios-http.com/)**: Promise-based HTTP client for making requests to external sites.
*   **[SheetJS (xlsx)](https://sheetjs.com/)**: Library for parsing and generating Excel spreadsheets.

#### Frontend
*   **[EJS (Embedded JavaScript)](https://ejs.co/)**: Simple templating language that lets you generate HTML markup with plain JavaScript.
*   **[Bootstrap 5](https://getbootstrap.com/)**: Powerful, extensible, and feature-packed frontend toolkit for responsive design.
*   **Server-Sent Events (SSE)**: Standard web technology for streaming updates from server to client.
