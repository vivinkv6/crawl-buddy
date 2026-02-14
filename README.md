# Crawl Buddy

## Pre-Launch SEO Migration Validation

Crawl Buddy is a powerful, real-time SEO migration tool designed to validate site migrations before they go live. It crawls your old site and compares it against the new site structure to ensure a seamless transition, catching critical SEO issues like broken links and metadata mismatches.

### Key Features

*   **Real-Time Comparison**: Streams crawl results instantly using Server-Sent Events (SSE), providing immediate feedback without waiting for the entire crawl to finish.
*   **Comprehensive SEO Checks**:
    *   **Status Codes**: Identifies 404 errors, 500 server errors, and redirect chains.
    *   **Meta Tag Validation**: Compares Title tags, Meta Descriptions, and H1 headers between old and new pages.
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
