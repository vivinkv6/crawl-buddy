document.addEventListener('DOMContentLoaded', () => {
  let currentImages = [];
  let currentImageIndex = 0;
  let scrapedPages = [];
  let eventSource = null;
  let isScraping = false;
  let leaveCallback = null;

  const scrapeForm = document.getElementById('scrapeForm');
  const setupCard = document.getElementById('setupCard');
  const scrapeButton = document.getElementById('scrapeButton');
  const resultCard = document.getElementById('resultCard');
  const errorAlert = document.getElementById('errorAlert');
  const downloadButton = document.getElementById('downloadButton');
  const scrapedDataAccordion = document.getElementById('scrapedDataAccordion');
  const streamingStatus = document.getElementById('streamingStatus');
  const statusIndicator = streamingStatus.querySelector('.status-indicator');
  const statusText = streamingStatus.querySelector('.status-text');
  const statusDetail = document.getElementById('statusDetail');
  const progressContainer = document.getElementById('progressContainer');
  const progressBar = document.getElementById('progressBar');
  const resultsCount = document.getElementById('resultsCount');
  const resultsStats = document.getElementById('resultsStats');
  const contentTypeSelect = document.getElementById('contentType');
  const btnDownloadMedia = document.getElementById('btnDownloadMedia');
  const btnExportExcel = document.getElementById('btnExportExcel');

  const showNotification = (message, type = 'info') => {
    if (type === 'success') notificationSystem.success(message);
    else if (type === 'error') notificationSystem.error(message);
    else if (type === 'warning') notificationSystem.warning(message);
    else notificationSystem.info(message);
  };

  // Leave warning modal
  const leaveWarningModal = document.getElementById('leaveWarningModal');
  const btnStayOnPage = document.getElementById('btnStayOnPage');
  const btnLeavePage = document.getElementById('btnLeavePage');

  btnStayOnPage.addEventListener('click', () => {
    leaveWarningModal.classList.add('d-none');
  });

  btnLeavePage.addEventListener('click', () => {
    leaveWarningModal.classList.add('d-none');
    if (leaveCallback) {
      leaveCallback();
    }
  });

  const showLeaveWarning = (callback) => {
    leaveCallback = callback;
    leaveWarningModal.classList.remove('d-none');
  };

  // Intercept keyboard shortcuts for refresh (F5, Ctrl+R, Ctrl+Shift+R)
  document.addEventListener('keydown', (e) => {
    if (isScraping && (e.key === 'F5' || (e.ctrlKey && e.key === 'r') || (e.ctrlKey && e.shiftKey && e.key === 'R'))) {
      e.preventDefault();
      showLeaveWarning(() => {
        window.location.reload();
      });
    }
  });

  // Intercept link clicks using event delegation (only when scraping is active)
  document.body.addEventListener('click', (e) => {
    if (!isScraping) return;
    
    // Ignore clicks on buttons that should not trigger navigation
    const ignoredSelectors = ['button', 'input[type="button"]', 'input[type="submit"]', '.btn', '#scrapeButton', '#btnNewScrape', '#downloadButton', '#btnStayOnPage', '#btnLeavePage'];
    for (const selector of ignoredSelectors) {
      if (e.target.closest(selector)) {
        return;
      }
    }
    
    const link = e.target.closest('a');
    if (link && link.href && !link.href.startsWith('#') && !link.href.startsWith('javascript')) {
      e.preventDefault();
      e.stopPropagation();
      const targetUrl = link.href;
      showLeaveWarning(() => {
        window.location.href = targetUrl;
      });
    }
  });

  // Handle browser back/forward button
  window.addEventListener('popstate', (e) => {
    if (isScraping) {
      showLeaveWarning(() => {
        history.back();
      });
    }
  });
  const scopeOptions = document.querySelectorAll('.scope-option');
  const websiteUrlGroup = document.getElementById('websiteUrlGroup');
  const sitemapUrlGroup = document.getElementById('sitemapUrlGroup');
  const websiteUrlInput = document.getElementById('websiteUrl');
  const sitemapUrlInput = document.getElementById('sitemapUrl');

  scopeOptions.forEach(option => {
    const radio = option.querySelector('input[type="radio"]');
    radio.addEventListener('change', () => {
      scopeOptions.forEach(opt => opt.classList.remove('scope-option--active'));
      option.classList.add('scope-option--active');

      const scope = radio.value;
      if (scope === 'entire') {
        websiteUrlGroup.classList.add('d-none');
        sitemapUrlGroup.classList.remove('d-none');
        websiteUrlInput.required = false;
        sitemapUrlInput.required = true;
        websiteUrlInput.value = '';
      } else {
        websiteUrlGroup.classList.remove('d-none');
        sitemapUrlGroup.classList.add('d-none');
        websiteUrlInput.required = true;
        sitemapUrlInput.required = false;
        sitemapUrlInput.value = '';
      }
    });
  });

  const setStatus = (state, text, detail = '') => {
    statusIndicator.className = 'status-indicator';
    if (state === 'active') {
      statusIndicator.classList.add('active');
      statusText.textContent = text;
    } else if (state === 'error') {
      statusIndicator.classList.add('error');
      statusText.textContent = text;
    } else {
      statusText.textContent = text;
    }
    statusDetail.textContent = detail;

    // Also update results section status
    const resultsStatusIndicator = document.querySelector('#streamingStatusResults .status-indicator');
    const resultsStatusText = document.querySelector('#streamingStatusResults .status-text');
    const resultsStatusDetail = document.getElementById('statusDetailResults');
    if (resultsStatusIndicator && resultsStatusText && resultsStatusDetail) {
      resultsStatusIndicator.className = 'status-indicator';
      if (state === 'active') {
        resultsStatusIndicator.classList.add('active');
        resultsStatusText.textContent = text;
      } else if (state === 'error') {
        resultsStatusIndicator.classList.add('error');
        resultsStatusText.textContent = text;
      } else {
        resultsStatusText.textContent = text;
      }
      resultsStatusDetail.textContent = detail;
    }
  };

  const setProgress = (percent) => {
    progressContainer.classList.remove('d-none');
    progressBar.style.width = `${percent}%`;

    // Also update results section progress
    const resultsProgressContainer = document.getElementById('progressContainerResults');
    const resultsProgressBar = document.getElementById('progressBarResults');
    if (resultsProgressContainer && resultsProgressBar) {
      resultsProgressContainer.classList.remove('d-none');
      resultsProgressBar.style.width = `${percent}%`;
    }
  };

  const showLoading = () => {
    const spinner = scrapeButton.querySelector('.spinner');
    const playIcon = scrapeButton.querySelector('.play-icon');
    spinner.classList.remove('d-none');
    playIcon.classList.add('d-none');
    scrapeButton.disabled = true;
    resultCard.classList.add('d-none');
    errorAlert.classList.add('d-none');
    downloadButton.classList.add('d-none');
    downloadButton.disabled = true;
    scrapedPages = [];
    scrapedDataAccordion.innerHTML = '';
    progressBar.style.width = '0%';
    
    // Reset results section progress
    const resultsProgressContainer = document.getElementById('progressContainerResults');
    const resultsProgressBar = document.getElementById('progressBarResults');
    if (resultsProgressContainer && resultsProgressBar) {
      resultsProgressBar.style.width = '0%';
      resultsProgressContainer.classList.add('d-none');
    }
    
    setStatus('active', 'Initializing...', 'Setting up the crawler');
    notificationSystem.info('Starting web scraping process...');
  };

  const hideLoading = () => {
    const spinner = scrapeButton.querySelector('.spinner');
    const playIcon = scrapeButton.querySelector('.play-icon');
    spinner.classList.add('d-none');
    playIcon.classList.remove('d-none');
    scrapeButton.disabled = false;
    progressContainer.classList.add('d-none');
    setStatus('idle', 'Completed', 'All pages have been scraped');
  };

  const showError = (message) => {
    errorAlert.textContent = message;
    errorAlert.classList.remove('d-none');
    resultCard.classList.add('d-none');
    downloadButton.disabled = true;
    setStatus('error', 'Error', message);
    notificationSystem.error(message);
  };

  const getDocumentIcon = (type) => {
    const icons = {
      pdf: 'pdf',
      doc: 'word', docx: 'word',
      xls: 'excel', xlsx: 'excel',
      ppt: 'powerpoint', pptx: 'powerpoint',
      txt: 'text'
    };
    return icons[type.toLowerCase()] || 'file';
  };

  const getSocialMediaIcon = (platform) => {
    const icons = {
      facebook: 'facebook',
      twitter: 'twitter-x', x: 'twitter-x',
      instagram: 'instagram',
      linkedin: 'linkedin',
      youtube: 'youtube',
      pinterest: 'pinterest',
      tiktok: 'tiktok',
      github: 'github',
      snapchat: 'snapchat',
      reddit: 'reddit',
      twitch: 'twitch',
      discord: 'discord',
      telegram: 'telegram',
      medium: 'medium',
      vimeo: 'vimeo',
      behance: 'behance',
      dribbble: 'dribbble'
    };
    return icons[platform.toLowerCase()] || 'link';
  };

  const createAccordionItem = (title, content, id, itemCount) => {
    const accordionItem = document.createElement('div');
    accordionItem.className = 'accordion-item';

    const header = document.createElement('h2');
    header.className = 'accordion-header';

    const button = document.createElement('button');
    button.className = 'accordion-button collapsed';
    button.type = 'button';
    button.setAttribute('data-bs-toggle', 'collapse');
    button.setAttribute('data-bs-target', `#${id}`);
    button.setAttribute('aria-expanded', 'false');
    button.setAttribute('aria-controls', id);
    button.textContent = `${title} (${itemCount})`;

    const collapseDiv = document.createElement('div');
    collapseDiv.id = id;
    collapseDiv.className = 'accordion-collapse collapse';

    const body = document.createElement('div');
    body.className = 'accordion-body';
    body.appendChild(content);

    header.appendChild(button);
    collapseDiv.appendChild(body);
    accordionItem.appendChild(header);
    accordionItem.appendChild(collapseDiv);

    return accordionItem;
  };

  const createMetaTagsSection = (metaTags) => {
    const container = document.createElement('div');
    if (!metaTags || metaTags.length === 0) {
      container.textContent = 'No meta tags found';
      return container;
    }

    const table = document.createElement('table');
    table.className = 'table table-hover table-sm';
    table.innerHTML = `
      <thead>
        <tr>
          <th style="width: 120px;">Type</th>
          <th style="width: 180px;">Name/Property</th>
          <th>Content</th>
        </tr>
      </thead>
      <tbody>
        ${metaTags.map(tag => `
          <tr>
            <td>${tag.name ? '<span class="badge bg-secondary-subtle text-secondary">name</span>' : '<span class="badge bg-info-subtle text-info">property</span>'}</td>
            <td><code class="small">${tag.name || tag.property}</code></td>
            <td style="word-break: break-word; white-space: pre-wrap;">${tag.content || '-'}</td>
          </tr>
        `).join('')}
      </tbody>
    `;
    container.appendChild(table);
    return container;
  };

  const imageModal = new bootstrap.Modal(document.getElementById('imageModal'));
  const modalImage = document.getElementById('modalImage');
  const prevImageBtn = document.getElementById('prevImage');
  const nextImageBtn = document.getElementById('nextImage');

  const resolveImageUrl = (url, baseUrl) => {
    try {
      if (url.startsWith('http://') || url.startsWith('https://')) return url;
      if (url.startsWith('//')) return 'https:' + url;
      return new URL(url, baseUrl).href;
    } catch {
      return null;
    }
  };

  const updateImageModal = (src) => {
    if (!src) return;
    const absoluteUrl = src.startsWith('/') ? window.location.origin + src : src;
    modalImage.src = absoluteUrl;
    prevImageBtn.disabled = currentImageIndex === 0;
    nextImageBtn.disabled = currentImageIndex === currentImages.length - 1;
  };

  prevImageBtn.addEventListener('click', () => {
    if (currentImageIndex > 0) {
      currentImageIndex--;
      updateImageModal(currentImages[currentImageIndex]);
    }
  });

  nextImageBtn.addEventListener('click', () => {
    if (currentImageIndex < currentImages.length - 1) {
      currentImageIndex++;
      updateImageModal(currentImages[currentImageIndex]);
    }
  });

  document.getElementById('imageModal').addEventListener('hidden.bs.modal', () => {
    modalImage.src = '';
  });

  const createImagesSection = (images, baseUrl) => {
    const container = document.createElement('div');
    if (!images || images.length === 0) {
      container.textContent = 'No images found';
      return container;
    }

    container.className = 'row row-cols-2 row-cols-md-4 row-cols-lg-6 g-2';
    images.forEach((src, index) => {
      const absoluteUrl = resolveImageUrl(src, baseUrl) || src;

      const col = document.createElement('div');
      col.className = 'col';
      col.innerHTML = `
        <div class="card h-100 image-card" role="button">
          <img src="${absoluteUrl}" class="card-img-top" alt="Scraped image" 
               onerror="this.onerror=null; this.src='data:image/svg+xml;base64,PHN2ZyB3aWR0aD0iMTUwIiBoZWlnaHQ9IjE1MCIgeG1sbnM9Imh0dHA6Ly93d3cudzMub3JnLzIwMDAvc3ZnIj48cmVjdCB3aWR0aD0iMTUwIiBoZWlnaHQ9IjE1MCIgZmlsbD0iI2VlZSIvPjx0ZXh0IHg9IjUwJSIgeT0iNTAlIiBmb250LWZhbWlseT0iQXJpYWwiIGZvbnQtc2l6ZT0iMTQiIHRleHQtYW5jaG9yPSJtaWRkbGUiIGR5PVwiLjNlbVwiIGZpbGw9IiNhYWEiPkltYWdlPC90ZXh0Pjwvc3ZnPg=='">
        </div>
      `;

      col.querySelector('.image-card').addEventListener('click', () => {
        currentImages = images.map(imgSrc => resolveImageUrl(imgSrc, baseUrl) || imgSrc);
        currentImageIndex = index;
        updateImageModal(absoluteUrl);
        imageModal.show();
      });

      container.appendChild(col);
    });
    return container;
  };

  let currentVideos = [];
  let currentVideoIndex = 0;

  const videoModal = new bootstrap.Modal(document.getElementById('videoModal'));
  const videoContainer = document.getElementById('videoContainer');
  const prevVideo = document.getElementById('prevVideo');
  const nextVideo = document.getElementById('nextVideo');

  const updateVideoModal = (src) => {
    if (!src) return;
    const extMatch = src.match(/\.([^.?#]+)(?:[?#]|$)/);
    const ext = extMatch ? extMatch[1].toLowerCase() : '';
    const videoTypes = { mp4: 'video/mp4', webm: 'video/webm', ogg: 'video/ogg', avi: 'video/avi', mov: 'video/quicktime' };
    if (videoTypes[ext]) {
      videoContainer.innerHTML = `<video controls autoplay playsinline style="width: 100%; height: 100%; max-height: 70vh;"><source src="${src}" type="${videoTypes[ext]}">Your browser does not support the video tag.</video>`;
    } else {
      videoContainer.innerHTML = `<iframe src="${src}" frameborder="0" allowfullscreen allow="accelerometer; autoplay; clipboard-write; encrypted-media; gyroscope; picture-in-picture" style="width: 100%; height: 70vh;"></iframe>`;
    }
    prevVideo.disabled = currentVideoIndex === 0;
    nextVideo.disabled = currentVideoIndex === currentVideos.length - 1;
  };

  prevVideo.addEventListener('click', () => {
    if (currentVideoIndex > 0) {
      currentVideoIndex--;
      updateVideoModal(currentVideos[currentVideoIndex]);
    }
  });

  nextVideo.addEventListener('click', () => {
    if (currentVideoIndex < currentVideos.length - 1) {
      currentVideoIndex++;
      updateVideoModal(currentVideos[currentVideoIndex]);
    }
  });

  document.getElementById('videoModal').addEventListener('hidden.bs.modal', () => {
    videoContainer.innerHTML = '';
  });

  const createVideosSection = (videos) => {
    const container = document.createElement('div');
    if (!videos || videos.length === 0) {
      container.textContent = 'No videos found';
      return container;
    }

    container.className = 'row row-cols-1 row-cols-md-2 g-3';
    videos.forEach((src, index) => {
      const col = document.createElement('div');
      col.className = 'col';
      let hostname = '';
      try { hostname = new URL(src).hostname; } catch (e) { hostname = 'Video'; }
      col.innerHTML = `
        <div class="card h-100 video-card" role="button">
          <div class="ratio ratio-16x9 position-relative">
            <div class="video-thumbnail d-flex align-items-center justify-content-center">
              <i class="bi bi-play-circle-fill display-1 text-white"></i>
            </div>
          </div>
          <div class="card-body">
            <p class="card-text small text-muted text-truncate">${hostname}</p>
          </div>
        </div>
      `;

      col.querySelector('.video-card').addEventListener('click', () => {
        currentVideos = [...videos];
        currentVideoIndex = index;
        updateVideoModal(currentVideos[index]);
        setTimeout(() => videoModal.show(), 100);
      });

      container.appendChild(col);
    });
    return container;
  };

  const createDocumentsSection = (documents) => {
    const container = document.createElement('div');
    if (!documents || documents.length === 0) {
      container.textContent = 'No documents found';
      return container;
    }

    const list = document.createElement('div');
    list.className = 'list-group';
    documents.forEach(doc => {
      const ext = doc.split('.').pop().toLowerCase();
      const icon = getDocumentIcon(ext);
      list.innerHTML += `
        <a href="${doc}" class="list-group-item" target="_blank">
          <i class="bi bi-file-earmark-${icon} text-primary"></i>
          <span class="text-truncate">${doc}</span>
        </a>
      `;
    });
    container.appendChild(list);
    return container;
  };

  const createSocialMediaSection = (socialLinks) => {
    const container = document.createElement('div');
    if (!socialLinks || socialLinks.length === 0) {
      container.textContent = 'No social media links found';
      return container;
    }

    const list = document.createElement('div');
    list.className = 'list-group';
    socialLinks.forEach(link => {
      try {
        const url = new URL(link);
        const platform = url.hostname.replace('www.', '').split('.')[0];
        const icon = getSocialMediaIcon(platform);
        list.innerHTML += `
          <a href="${link}" class="list-group-item" target="_blank">
            <i class="bi bi-${icon} text-primary"></i>
            <span class="text-truncate">${url.hostname}</span>
          </a>
        `;
      } catch {
        list.innerHTML += `
          <a href="${link}" class="list-group-item" target="_blank">
            <i class="bi bi-link text-primary"></i>
            <span class="text-truncate">${link}</span>
          </a>
        `;
      }
    });
    container.appendChild(list);
    return container;
  };

  const createLinksSection = (links) => {
    const container = document.createElement('div');
    if (!links || links.length === 0) {
      container.textContent = 'No links found';
      return container;
    }

    const list = document.createElement('div');
    list.className = 'list-group';
    links.slice(0, 50).forEach(link => {
      list.innerHTML += `
        <a href="${link}" class="list-group-item" target="_blank">
          <i class="bi bi-link-45deg text-secondary"></i>
          <span class="text-truncate">${new URL(link).pathname || '/'}</span>
        </a>
      `;
    });
    if (links.length > 50) {
      list.innerHTML += `<div class="list-group-item text-muted">...and ${links.length - 50} more links</div>`;
    }
    container.appendChild(list);
    return container;
  };

  const createContentSection = (content) => {
    const container = document.createElement('div');
    if (!content || content.length === 0) {
      container.textContent = 'No content found';
      return container;
    }

    const contentDiv = document.createElement('div');
    contentDiv.className = 'content-text';

    content.forEach(item => {
      if (!item || !item.type) return;

      try {
        switch (item.type.toLowerCase()) {
          case 'heading':
            if (item.level >= 1 && item.level <= 6 && item.text) {
              const heading = document.createElement(`h${item.level}`);
              heading.innerHTML = item.text.trim();
              contentDiv.appendChild(heading);
            }
            break;
          case 'paragraph':
            if (item.text) {
              const paragraph = document.createElement('p');
              paragraph.innerHTML = item.text.trim();
              contentDiv.appendChild(paragraph);
            }
            break;
          case 'list':
            if (item.items && Array.isArray(item.items)) {
              const list = document.createElement(item.listType === 'ordered' ? 'ol' : 'ul');
              list.className = 'content-list';
              item.items.forEach(listItem => {
                const li = document.createElement('li');
                if (typeof listItem === 'object' && listItem.text) {
                  li.innerHTML = listItem.text.trim();
                } else if (typeof listItem === 'string') {
                  li.innerHTML = listItem.trim();
                }
                list.appendChild(li);
              });
              contentDiv.appendChild(list);
            }
            break;
        }
      } catch (error) {
        console.error('Error creating content element:', error);
      }
    });

    container.appendChild(contentDiv);
    return container;
  };

  const createContactsSection = (contacts) => {
    const container = document.createElement('div');
    if (!contacts || (contacts.emails.length === 0 && contacts.phones.length === 0 && contacts.whatsapp.length === 0)) {
      container.textContent = 'No contact information found';
      return container;
    }

    const list = document.createElement('div');
    list.className = 'list-group';

    contacts.emails.forEach(email => {
      list.innerHTML += `
        <a href="mailto:${email}" class="list-group-item">
          <i class="bi bi-envelope text-primary"></i>
          ${email}
        </a>
      `;
    });

    contacts.phones.forEach(phone => {
      list.innerHTML += `
        <a href="tel:${phone}" class="list-group-item">
          <i class="bi bi-telephone text-success"></i>
          ${phone}
        </a>
      `;
    });

    contacts.whatsapp.forEach(whatsapp => {
      list.innerHTML += `
        <a href="${whatsapp}" class="list-group-item" target="_blank">
          <i class="bi bi-whatsapp text-success"></i>
          ${whatsapp}
        </a>
      `;
    });

    container.appendChild(list);
    return container;
  };

  const createPageAccordion = (pageData, pageIndex) => {
    const pageAccordion = document.createElement('div');
    pageAccordion.className = 'accordion mb-3';
    pageAccordion.id = `page-${pageIndex}`;

    if (pageData.meta) {
      pageAccordion.appendChild(
        createAccordionItem('Meta Tags', createMetaTagsSection(pageData.meta), `meta-${pageIndex}`, pageData.meta.length)
      );
    }

    if (pageData.images) {
      pageAccordion.appendChild(
        createAccordionItem('Images', createImagesSection(pageData.images, pageData.url), `images-${pageIndex}`, pageData.images.length)
      );
    }

    if (pageData.videos) {
      pageAccordion.appendChild(
        createAccordionItem('Videos', createVideosSection(pageData.videos), `videos-${pageIndex}`, pageData.videos.length)
      );
    }

    if (pageData.documents) {
      pageAccordion.appendChild(
        createAccordionItem('Documents', createDocumentsSection(pageData.documents), `documents-${pageIndex}`, pageData.documents.length)
      );
    }

    if (pageData.socialMedia) {
      pageAccordion.appendChild(
        createAccordionItem('Social Media', createSocialMediaSection(pageData.socialMedia), `social-${pageIndex}`, pageData.socialMedia.length)
      );
    }

    if (pageData.links) {
      pageAccordion.appendChild(
        createAccordionItem('Links', createLinksSection(pageData.links), `links-${pageIndex}`, pageData.links.length)
      );
    }

    if (pageData.content) {
      pageAccordion.appendChild(
        createAccordionItem('Content', createContentSection(pageData.content), `content-${pageIndex}`, 1)
      );
    }

    if (pageData.contacts) {
      const contactsCount = (pageData.contacts.emails.length + pageData.contacts.phones.length + pageData.contacts.whatsapp.length);
      pageAccordion.appendChild(
        createAccordionItem('Contacts', createContactsSection(pageData.contacts), `contacts-${pageIndex}`, contactsCount)
      );
    }

    return pageAccordion;
  };

  const displayScrapedData = (data) => {
    scrapedDataAccordion.innerHTML = '';
    scrapedDataAccordion.classList.add('list-view');
    resultCard.classList.remove('d-none');
    downloadButton.classList.remove('d-none');
    downloadButton.disabled = false;

    const pages = data.pages || [data];
    resultsCount.textContent = `${pages.length} page${pages.length !== 1 ? 's' : ''}`;

    const stats = calculateStats(pages);
    renderStats(stats);

    pages.forEach((pageData, index) => {
      const slno = index + 1;
      const pageTitle = pageData.url ? new URL(pageData.url).pathname || new URL(pageData.url).hostname : `Page ${slno}`;
      const pageId = `page-${index}`;

      const pageAccordionItem = createPageAccordionItem(`#${slno} - ${pageTitle}`, pageData, pageId, index);
      scrapedDataAccordion.appendChild(pageAccordionItem);
    });
  };

  const calculateStats = (pages) => {
    const stats = {
      total: pages.length,
      meta: 0,
      images: 0,
      videos: 0,
      links: 0,
      content: 0,
      documents: 0,
      social: 0,
      contacts: 0
    };

    pages.forEach(page => {
      stats.meta += page.meta?.length || 0;
      stats.images += page.images?.length || 0;
      stats.videos += page.videos?.length || 0;
      stats.links += page.links?.length || 0;
      stats.content += page.content?.length || 0;
      stats.documents += page.documents?.length || 0;
      stats.social += page.socialMedia?.length || 0;
      if (page.contacts) {
        stats.contacts += (page.contacts.emails?.length || 0) + (page.contacts.phones?.length || 0) + (page.contacts.whatsapp?.length || 0);
      }
    });

    return stats;
  };

  const renderStats = (stats) => {
    const icons = {
      meta: 'bi-tags',
      images: 'bi-image',
      videos: 'bi-play-circle',
      links: 'bi-link-45deg',
      content: 'bi-file-text',
      documents: 'bi-file-earmark',
      social: 'bi-share',
      contacts: 'bi-person-contact'
    };

    const labels = {
      meta: 'Meta Tags',
      images: 'Images',
      videos: 'Videos',
      links: 'Links',
      content: 'Content',
      documents: 'Documents',
      social: 'Social',
      contacts: 'Contacts'
    };

    let html = `
      <div class="stat-item">
        <i class="bi bi-collection"></i>
        <span class="stat-value">${stats.total}</span>
        <span class="stat-label">Total Pages</span>
      </div>
    `;

    Object.keys(stats).forEach(key => {
      if (key !== 'total' && stats[key] > 0) {
        html += `
          <div class="stat-item">
            <i class="bi ${icons[key]}"></i>
            <span class="stat-value">${stats[key]}</span>
            <span class="stat-label">${labels[key]}</span>
          </div>
        `;
      }
    });

    resultsStats.innerHTML = html;

    if (stats.images > 0 || stats.videos > 0 || stats.documents > 0) {
      btnDownloadMedia.classList.remove('d-none');
      btnDownloadMedia.classList.add('btn-media');
    } else {
      btnDownloadMedia.classList.add('d-none');
      btnDownloadMedia.classList.remove('btn-media');
    }
  };

  const createPageAccordionItem = (title, pageData, pageId, index) => {
    const pageAccordionItem = document.createElement('div');
    pageAccordionItem.className = 'accordion-item';

    const pageUrl = pageData.url || '';

    const badges = [];
    if (pageData.meta?.length) badges.push({ type: 'meta', count: pageData.meta.length });
    if (pageData.images?.length) badges.push({ type: 'images', count: pageData.images.length });
    if (pageData.videos?.length) badges.push({ type: 'videos', count: pageData.videos.length });
    if (pageData.links?.length) badges.push({ type: 'links', count: pageData.links.length });
    if (pageData.content?.length) badges.push({ type: 'content', count: 1 });
    if (pageData.documents?.length) badges.push({ type: 'documents', count: pageData.documents.length });
    if (pageData.socialMedia?.length) badges.push({ type: 'social', count: pageData.socialMedia.length });
    if (pageData.contacts?.emails?.length || pageData.contacts?.phones?.length || pageData.contacts?.whatsapp?.length) {
      badges.push({ type: 'contacts', count: (pageData.contacts.emails?.length || 0) + (pageData.contacts.phones?.length || 0) + (pageData.contacts.whatsapp?.length || 0) });
    }

    const pageHeader = document.createElement('h2');
    pageHeader.className = 'accordion-header';

    const pageButton = document.createElement('button');
    pageButton.className = 'accordion-button collapsed';
    pageButton.type = 'button';
    pageButton.setAttribute('data-bs-toggle', 'collapse');
    pageButton.setAttribute('data-bs-target', `#${pageId}`);
    pageButton.setAttribute('aria-expanded', 'false');
    pageButton.setAttribute('aria-controls', pageId);
    
    const badgeLabels = {
      meta: 'Meta Tags',
      images: 'Images',
      videos: 'Videos',
      links: 'Links',
      content: 'Content',
      documents: 'Documents',
      social: 'Social Media',
      contacts: 'Contact Info'
    };

    const badgesHtml = badges.map(b => `<span class="page-card-badge ${b.type}" title="${badgeLabels[b.type] || b.type}">${b.count}</span>`).join('');
    pageButton.innerHTML = `
      <div class="d-flex align-items-center gap-3 w-100 me-3">
        <i class="bi bi-file-earmark-page text-primary"></i>
        <span class="text-truncate me-auto">${title}</span>
        <div class="d-none d-md-flex gap-1 flex-shrink-0">${badgesHtml}</div>
      </div>
    `;

    const pageCollapseDiv = document.createElement('div');
    pageCollapseDiv.id = pageId;
    pageCollapseDiv.className = 'accordion-collapse collapse';

    const pageBody = document.createElement('div');
    pageBody.className = 'accordion-body p-0';
    
    const urlDiv = document.createElement('div');
    urlDiv.className = 'px-3 py-2 bg-light border-bottom';
    urlDiv.innerHTML = `<small class="text-muted font-monospace">${pageUrl}</small>`;
    
    const contentAccordion = createPageAccordion(pageData, index);
    pageBody.appendChild(urlDiv);
    pageBody.appendChild(contentAccordion);

    pageHeader.appendChild(pageButton);
    pageCollapseDiv.appendChild(pageBody);
    pageAccordionItem.appendChild(pageHeader);
    pageAccordionItem.appendChild(pageCollapseDiv);

    return pageAccordionItem;
  };

  const addPageResult = (pageData, totalPages) => {
    scrapedPages.push(pageData);
    const percent = totalPages > 0 ? Math.round((scrapedPages.length / totalPages) * 0) : 0;
    setProgress(percent);
    setStatus('active', `Scraping pages`, `${scrapedPages.length} of ${totalPages || '?'} pages`);
    
    if (scrapedPages.length === 1) {
      scrapedDataAccordion.classList.add('list-view');
      resultCard.classList.remove('d-none');
    }
    
    resultsCount.textContent = `${scrapedPages.length} page${scrapedPages.length !== 1 ? 's' : ''}`;
    
    const stats = calculateStats(scrapedPages);
    renderStats(stats);
    
    const index = scrapedPages.length - 1;
    const slno = index + 1;
    const pageTitle = pageData.url ? new URL(pageData.url).pathname || new URL(pageData.url).hostname : `Page ${slno}`;
    const pageId = `page-${index}`;

    const existingItem = document.getElementById(pageId);
    if (existingItem) {
      const contentAccordion = createPageAccordion(pageData, index);
      existingItem.querySelector('.accordion-body').innerHTML = '';
      const urlDiv = document.createElement('div');
      urlDiv.className = 'px-3 py-2 bg-light border-bottom';
      urlDiv.innerHTML = `<small class="text-muted font-monospace">${pageData.url || ''}</small>`;
      existingItem.querySelector('.accordion-body').appendChild(urlDiv);
      existingItem.querySelector('.accordion-body').appendChild(contentAccordion);
    } else {
      const pageAccordionItem = createPageAccordionItem(`#${slno} - ${pageTitle}`, pageData, pageId, index);
      scrapedDataAccordion.appendChild(pageAccordionItem);
    }

    window.scrapedData = { pages: scrapedPages };
  };

  const downloadScrapedData = async (data) => {
    try {
      const response = await fetch('/scraper/download', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          data,
          contentType: contentTypeSelect.value,
          scrapeScope: document.querySelector('input[name="crawlScope"]:checked').value
        }),
      });

      if (response.ok) {
        const blob = await response.blob();
        const url = window.URL.createObjectURL(blob);
        const a = document.createElement('a');
        a.href = url;
        a.download = 'scraped-data.zip';
        document.body.appendChild(a);
        a.click();
        window.URL.revokeObjectURL(url);
        a.remove();
      } else {
        const errorData = await response.json();
        showError(errorData.error || 'Failed to download the scraped data');
      }
    } catch (error) {
      showError('An error occurred while downloading the scraped data');
    }
  };

  const handleDownload = async () => {
    downloadButton.disabled = true;
    try {
      await downloadScrapedData(window.scrapedData, contentTypeSelect.value);
    } catch (error) {
      console.error('Download error:', error);
      showError('Failed to process data. Please try again.');
    } finally {
      downloadButton.disabled = false;
    }
  };

  downloadButton.addEventListener('click', handleDownload);

  const btnNewScrape = document.getElementById('btnNewScrape');
  btnNewScrape.addEventListener('click', () => {
    if (eventSource) {
      eventSource.close();
      eventSource = null;
    }
    isScraping = false;
    setupCard.style.display = 'block';
    resultCard.classList.add('d-none');
    scrapedDataAccordion.innerHTML = '';
    scrapedPages = [];
    scrapeForm.reset();
    scrapeButton.disabled = false;
    scrapeButton.querySelector('.spinner').classList.add('d-none');
    scrapeButton.querySelector('.play-icon').classList.remove('d-none');
    btnDownloadMedia.classList.add('d-none');
  });

  btnDownloadMedia.addEventListener('click', async () => {
    const stats = calculateStats(scrapedPages);
    const hasImages = stats.images > 0;
    const hasVideos = stats.videos > 0;
    
    if (!hasImages && !hasVideos) {
      notificationSystem.warning('No media files to download');
      return;
    }

    const mediaFiles = [];
    scrapedPages.forEach(page => {
      if (page.images) {
        page.images.forEach(img => {
          const imgUrl = typeof img === 'string' ? img : (img.src || img.url);
          if (imgUrl) {
            mediaFiles.push({ type: 'image', url: imgUrl, pageUrl: page.url });
          }
        });
      }
      if (page.videos) {
        page.videos.forEach(vid => {
          const vidUrl = typeof vid === 'string' ? vid : (vid.src || vid.url);
          if (vidUrl) {
            mediaFiles.push({ type: 'video', url: vidUrl, pageUrl: page.url });
          }
        });
      }
      if (page.documents) {
        page.documents.forEach(doc => {
          const docUrl = typeof doc === 'string' ? doc : (doc.src || doc.url);
          if (docUrl) {
            const docType = docUrl.toLowerCase().includes('.pdf') ? 'pdf' : 'document';
            mediaFiles.push({ type: docType, url: docUrl, pageUrl: page.url });
          }
        });
      }
    });

    if (mediaFiles.length === 0) {
      notificationSystem.warning('No media files to download');
      return;
    }

    btnDownloadMedia.disabled = true;
    btnDownloadMedia.innerHTML = '<i class="bi bi-hourglass-split"></i> Downloading...';

    const progressNotification = notificationSystem.showProgress(`Downloading 0/${mediaFiles.length}`, 0);
    
    let progress = 0;
    const totalFiles = mediaFiles.length;
    const progressInterval = setInterval(() => {
      progress = Math.min(progress + Math.ceil(100 / (totalFiles * 2)), 95);
      const currentCount = Math.floor((progress / 100) * totalFiles);
      const progressBar = progressNotification.querySelector('.notification-progress');
      if (progressBar) {
        progressBar.style.width = `${progress}%`;
      }
      const textEl = progressNotification.querySelector('span');
      if (textEl) {
        textEl.textContent = `Downloading ${Math.min(currentCount, totalFiles)}/${totalFiles}`;
      }
    }, 500);
    
    try {
      const response = await fetch('/scraper/download-media', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ mediaFiles })
      });
      
      clearInterval(progressInterval);
      progressNotification.querySelector('.notification-progress').style.width = '100%';
      const textEl = progressNotification.querySelector('span');
      if (textEl) {
        textEl.textContent = `Downloading ${totalFiles}/${totalFiles} - Complete!`;
      }
      
      if (response.ok) {
        const blob = await response.blob();
        const url = window.URL.createObjectURL(blob);
        const a = document.createElement('a');
        a.href = url;
        a.download = 'scraped-media.zip';
        document.body.appendChild(a);
        a.click();
        window.URL.revokeObjectURL(url);
        document.body.removeChild(a);
        notificationSystem.success('Media downloaded successfully');
      } else {
        notificationSystem.error('Failed to download media');
      }
    } catch (error) {
      clearInterval(progressInterval);
      notificationSystem.error('Error downloading media: ' + error.message);
    } finally {
      btnDownloadMedia.disabled = false;
      btnDownloadMedia.innerHTML = '<i class="bi bi-download"></i> Download Media';
    }
  });

  btnExportExcel.addEventListener('click', async () => {
    if (scrapedPages.length === 0) {
      notificationSystem.warning('No data to export');
      return;
    }

    btnExportExcel.disabled = true;
    btnExportExcel.innerHTML = '<i class="bi bi-hourglass-split"></i> Exporting...';

    const progressNotification = notificationSystem.showProgress('Preparing Excel file...', 0);
    
    try {
      const response = await fetch('/scraper/download', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          data: { pages: scrapedPages },
          contentType: 'all',
          scrapeScope: 'entire',
          format: 'xlsx'
        })
      });

      progressNotification.querySelector('.notification-progress').style.width = '100%';

      if (response.ok) {
        const blob = await response.blob();
        const url = window.URL.createObjectURL(blob);
        const a = document.createElement('a');
        a.href = url;
        a.download = 'scraped-data.xlsx';
        document.body.appendChild(a);
        a.click();
        window.URL.revokeObjectURL(url);
        document.body.removeChild(a);
        notificationSystem.success('Excel file exported successfully');
      } else {
        const error = await response.json();
        notificationSystem.error(error.error || 'Failed to export Excel');
      }
    } catch (error) {
      notificationSystem.error('Error exporting Excel: ' + error.message);
    } finally {
      btnExportExcel.disabled = false;
      btnExportExcel.innerHTML = '<i class="bi bi-file-earmark-excel"></i> Export Excel';
    }
  });

  scrapeForm.addEventListener('submit', async (e) => {
    e.preventDefault();

    if (eventSource) {
      eventSource.close();
      eventSource = null;
    }

    const crawlScope = document.querySelector('input[name="crawlScope"]:checked').value;
    const contentType = contentTypeSelect.value;
    
    let url;
    if (crawlScope === 'entire') {
      url = sitemapUrlInput.value.trim();
    } else {
      const websiteUrl = websiteUrlInput.value.trim();
      url = websiteUrl.startsWith('http') ? websiteUrl : `https://${websiteUrl}`;
    }

    if (!url) {
      showError('Please enter a valid URL');
      return;
    }

    showLoading();
    scrapedDataAccordion.innerHTML = '';
    scrapedPages = [];
    scrapedDataAccordion.classList.add('list-view');
    setupCard.style.display = 'none';
    resultCard.classList.remove('d-none');
    resultsStats.innerHTML = '';

    const params = new URLSearchParams({
      url: url,
      contentType: contentType,
      scrapeScope: crawlScope,
      maxPages: '10000'
    });

    isScraping = true;
    eventSource = new EventSource(`/scraper/scrape/stream?${params}`);

    eventSource.onmessage = (event) => {
      const msg = JSON.parse(event.data);
      
      if (msg.type === 'start') {
        setStatus('active', 'Scraping...', `Found ${msg.totalPages} pages`);
        progressContainer.classList.remove('d-none');
      } else if (msg.type === 'result') {
        const pageData = msg.page;
        scrapedPages.push(pageData);
        
        const percent = Math.round((msg.current / msg.total) * 100);
        setProgress(percent);
        setStatus('active', 'Scraping...', `Scraped ${msg.current} of ${msg.total} pages`);
        
        const stats = calculateStats(scrapedPages);
        renderStats(stats);
        resultsCount.textContent = `${scrapedPages.length} page${scrapedPages.length !== 1 ? 's' : ''}`;

        const slno = scrapedPages.length;
        const pageTitle = pageData.url ? new URL(pageData.url).pathname || new URL(pageData.url).hostname : `Page ${slno}`;
        const pageId = `page-${scrapedPages.length - 1}`;
        const pageAccordionItem = createPageAccordionItem(`#${slno} - ${pageTitle}`, pageData, pageId, scrapedPages.length - 1);
        scrapedDataAccordion.appendChild(pageAccordionItem);
      } else if (msg.type === 'complete') {
        eventSource.close();
        isScraping = false;
        hideLoading();
        setStatus('idle', 'Completed', `Scraped ${msg.totalPages} pages${msg.failed ? `, ${msg.failed} failed` : ''}`);
        progressContainer.classList.add('d-none');
        
        // Hide results progress
        const resultsProgressContainer = document.getElementById('progressContainerResults');
        if (resultsProgressContainer) {
          resultsProgressContainer.classList.add('d-none');
        }
        
        downloadButton.classList.remove('d-none');
        downloadButton.disabled = false;
        notificationSystem.success(`Successfully scraped ${msg.totalPages} pages!`);
        window.scrapedData = { pages: scrapedPages };
      } else if (msg.type === 'error') {
        eventSource.close();
        isScraping = false;
        hideLoading();
        showError(msg.message);
        setStatus('error', 'Error', msg.message);
      }
    };

    eventSource.onerror = () => {
      eventSource.close();
      isScraping = false;
      hideLoading();
      setStatus('error', 'Error', 'Connection lost');
    };
  });
});
