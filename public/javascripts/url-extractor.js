document.addEventListener('DOMContentLoaded', () => {
  // --- Element Selections ---
  const extractForm = document.getElementById('extractForm');
  const setupCard = document.getElementById('setupCard');
  const resultCard = document.getElementById('resultCard');
  const extractBtn = document.getElementById('extractBtn');
  const btnExportExcel = document.getElementById('btnExportExcel');
  const btnNewExtract = document.getElementById('btnNewExtract');
  const urlsTableBody = document.getElementById('urlsTableBody');
  const resultsCount = document.getElementById('resultsCount');

  const statusElements = {
    setup: {
      indicator: document.querySelector('#streamingStatus .status-indicator'),
      text: document.querySelector('#streamingStatus .status-text'),
      detail: document.getElementById('statusDetail'),
      progressContainer: document.getElementById('progressContainer'),
      progressBar: document.getElementById('progressBar'),
    },
    results: {
      indicator: document.querySelector('#streamingStatusResults .status-indicator'),
      text: document.querySelector('#streamingStatusResults .status-text'),
      detail: document.getElementById('statusDetailResults'),
      progressText: document.getElementById('progressText'),
    }
  };

  let extractedUrls = [];
  let isExtracting = false;
  let sseSource = null;
  let totalUrls = 0;

  // --- UI Update Functions ---
  const setStatus = (state, text, detail = '') => {
    Object.values(statusElements).forEach(group => {
      if (!group.indicator) return;
      group.indicator.className = 'status-indicator';
      if (state === 'active') group.indicator.classList.add('active');
      else if (state === 'error') group.indicator.classList.add('error');
      group.text.textContent = text;
      group.detail.textContent = detail;
    });
  };

  const updateProgressText = (current = 0, total = 0) => {
    if (statusElements.results.progressText) {
      statusElements.results.progressText.textContent = `${current} / ${total}`;
    }
  };
  
  const createUrlCard = (url, index) => {
    const row = document.createElement('tr');
    row.style.animationDelay = `${Math.min(index * 20, 1000)}ms`;
    row.innerHTML = `
      <td>${index}</td>
      <td class="url-cell">${url}</td>
      <td class="text-end">
        <button class="action-btn copy-btn" title="Copy to clipboard" data-url="${url}"><i class="bi bi-clipboard"></i></button>
        <a href="${url}" target="_blank" class="action-btn" title="Open in new tab"><i class="bi bi-box-arrow-up-right"></i></a>
      </td>
    `;
    return row;
  };

  // --- Event Handlers ---
  const handleExtract = (e) => {
    e.preventDefault();
    if (isExtracting) return;
    
    const sitemapUrl = document.getElementById('sitemapUrl').value.trim();
    if (!sitemapUrl) {
      window.notificationSystem.error('Please enter a sitemap URL');
      return;
    }

    isExtracting = true;
    extractedUrls = [];
    totalUrls = 0;
    urlsTableBody.innerHTML = '';
    setupCard.style.display = 'none';
    resultCard.classList.remove('d-none');
    
    extractBtn.disabled = true;
    extractBtn.querySelector('.spinner').classList.remove('d-none');
    extractBtn.querySelector('.play-icon').classList.add('d-none');
    updateProgressText(0, 0);
    setStatus('active', 'Initializing...', 'Connecting to sitemap');
    window.notificationSystem.info('Starting URL extraction...');

    sseSource = new EventSource(`/scraper/extract-urls?sitemapUrl=${encodeURIComponent(sitemapUrl)}`);

    sseSource.onmessage = (event) => {
      try {
        const data = JSON.parse(event.data);
        switch (data.type) {
          case 'start':
            totalUrls = data.total || 0;
            updateProgressText(0, totalUrls);
            setStatus('active', 'Extracting URLs...', `Found ${totalUrls} URLs - Starting extraction`);
            break;
          case 'result':
            extractedUrls.push(data.url);
            const newCard = createUrlCard(data.url, data.index);
            urlsTableBody.appendChild(newCard);
            
            totalUrls = data.total;
            updateProgressText(data.index, data.total);
            setStatus('active', `Extracting... ${data.index} of ${data.total}`, '');
            resultsCount.textContent = `${extractedUrls.length} URLs`;
            break;
          case 'complete':
            totalUrls = data.total;
            updateProgressText(data.total, data.total);
            setStatus('idle', 'Completed', `Successfully extracted ${data.total} URLs`);
            window.notificationSystem.success(`Extraction complete: ${data.total} URLs found.`);
            isExtracting = false;
            sseSource.close();
            extractBtn.disabled = false;
            extractBtn.querySelector('.spinner').classList.add('d-none');
            extractBtn.querySelector('.play-icon').classList.remove('d-none');
            break;
          case 'error':
            throw new Error(data.message);
        }
      } catch (err) {
        handleError(err);
      }
    };

    sseSource.onerror = () => {
      handleError(new Error('Connection to the server was lost. Please try again.'));
    };
  };
  
  const handleError = (error) => {
    setStatus('error', 'Error', error.message);
    window.notificationSystem.error(error.message);
    if (sseSource) sseSource.close();
    isExtracting = false;
    extractBtn.disabled = false;
    extractBtn.querySelector('.spinner').classList.add('d-none');
    extractBtn.querySelector('.play-icon').classList.remove('d-none');
  };

  const handleExport = async () => {
    if (extractedUrls.length === 0) {
      window.notificationSystem.warning('No URLs to export');
      return;
    }
    btnExportExcel.disabled = true;
    const originalContent = btnExportExcel.innerHTML;
    btnExportExcel.innerHTML = '<i class="bi bi-hourglass-split"></i> Exporting...';
    try {
      const response = await fetch('/scraper/extract-urls/export', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ urls: extractedUrls })
      });
      if (!response.ok) throw new Error((await response.json()).error || 'Export failed');
      const blob = await response.blob();
      const url = window.URL.createObjectURL(blob);
      const a = document.createElement('a');
      a.href = url;
      document.body.appendChild(a);
      a.click();
      document.body.removeChild(a);
      window.URL.revokeObjectURL(url);
      window.notificationSystem.success('Excel file exported successfully');
    } catch (error) {
      window.notificationSystem.error('Error exporting Excel: ' + error.message);
    } finally {
      btnExportExcel.disabled = false;
      btnExportExcel.innerHTML = originalContent;
    }
  };

  const handleNew = () => {
    if (isExtracting) {
      if (!confirm('Extraction is in progress. Are you sure you want to cancel and start a new one?')) return;
      if (sseSource) sseSource.close();
    }
    isExtracting = false;
    resultCard.classList.add('d-none');
    setupCard.style.display = 'block';
    urlsTableBody.innerHTML = '';
    extractedUrls = [];
    resultsCount.textContent = '0 URLs';
    extractForm.reset();
    setStatus('idle', 'Ready', 'Enter a sitemap URL to begin');
  };

  // --- Event Listeners ---
  if (extractForm) extractForm.addEventListener('submit', handleExtract);
  if (btnExportExcel) btnExportExcel.addEventListener('click', handleExport);
  if (btnNewExtract) btnNewExtract.addEventListener('click', handleNew);

  if (urlsTableBody) {
    urlsTableBody.addEventListener('click', function(e) {
      const copyBtn = e.target.closest('.copy-btn');
      if (copyBtn) {
        e.preventDefault();
        const urlToCopy = copyBtn.getAttribute('data-url');
        navigator.clipboard.writeText(urlToCopy).then(() => {
          window.notificationSystem.success('URL copied!');
          const icon = copyBtn.querySelector('i');
          icon.className = 'bi bi-check2';
          setTimeout(() => { icon.className = 'bi bi-clipboard'; }, 2000);
        });
      }
    });
  }
});
