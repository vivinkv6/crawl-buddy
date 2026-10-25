document.addEventListener('DOMContentLoaded', () => {
  const byId = (id) => document.getElementById(id);

  const setupCard = byId('setupCard');
  const auditForm = byId('auditForm');
  const websiteUrl = byId('websiteUrl');
  const urlLabelText = byId('urlLabelText');
  const urlHint = byId('urlHint');
  const modeInputs = Array.from(
    document.querySelectorAll('input[name="auditMode"]'),
  );
  const modeOptions = Array.from(
    document.querySelectorAll('.scope-option[data-mode]'),
  );
  const scopeInputs = Array.from(
    document.querySelectorAll('input[name="linkScope"]'),
  );
  const scopeOptions = Array.from(
    document.querySelectorAll('.scope-option[data-scope]'),
  );
  const urlError = byId('urlError');
  const startBtn = byId('startBtn');
  const startSpinner = byId('startSpinner');
  const startIcon = byId('startIcon');
  const startBtnText = startBtn.querySelector('.btn-text');
  const cancelBtn = byId('cancelBtn');

  const resultsCard = byId('resultsCard');
  const auditErrorBox = byId('auditErrorBox');
  const auditErrorMessage = byId('auditErrorMessage');
  const statusIndicator = byId('statusIndicator');
  const statusText = byId('statusText');
  const statusDetail = byId('statusDetail');
  const auditProgressBar = byId('auditProgressBar');

  const summaryPages = byId('summaryPages');
  const summaryChecked = byId('summaryChecked');
  const summaryHealthy = byId('summaryHealthy');
  const summaryBroken = byId('summaryBroken');
  const resultsTableBody = byId('resultsTableBody');
  const resultsCount = byId('resultsCount');
  const emptyResults = byId('emptyResults');
  const emptyResultsText = byId('emptyResultsText');
  const loadingResults = byId('loadingResults');
  const statusFilterButtons = Array.from(
    document.querySelectorAll('.filter-btn[data-status]'),
  );
  const exportBtn = byId('exportBtn');
  const newAuditBtn = byId('newAuditBtn');

  const detailOverlay = byId('detailOverlay');
  const detailPanel = byId('detailPanel');
  const detailBody = byId('detailBody');
  const closeDetailBtn = byId('closeDetailBtn');

  if (!auditForm) return;

  const state = {
    auditId: null,
    snapshot: null,
    terminal: false,
    sse: null,
    pollTimer: null,
    resultAbort: null,
    resultLoading: false,
    resultsLoadedOnce: false,
    lastResultFetch: 0,
    status: 'all',
    linkType: 'all',
    sortBy: 'sourcePage',
    sortDir: 'asc',
    detailId: null,
  };

  const issueLabels = {
    none: 'Healthy',
    pending: 'Pending',
    redirect: 'Redirect',
    not_found: '404 Not Found',
    gone: '410 Gone',
    server_error: '5xx Server Error',
    client_error: '4xx Client Error',
    access_restricted: 'Access Restricted',
    rate_limited: '429 Rate Limited',
    timeout: 'Timeout',
    dns_error: 'DNS Error',
    tls_error: 'TLS Error',
    connection_error: 'Connection Error',
    blocked: 'Blocked',
    invalid_url: 'Invalid URL',
    too_many_redirects: 'Too Many Redirects',
    redirect_loop: 'Redirect Loop',
    unsupported: 'Unsupported Response',
    other_error: 'Check Failed',
  };

  const notify = (level, message) => {
    if (window.notificationSystem && window.notificationSystem[level]) {
      window.notificationSystem[level](message);
    } else if (level === 'error') {
      console.error(message);
    } else {
      console.log(message);
    }
  };

  const formatNumber = (value) => Number(value || 0).toLocaleString();

  const humanizeIssue = (issue) =>
    issueLabels[issue] ||
    String(issue || 'Unknown')
      .replace(/_/g, ' ')
      .replace(/\b\w/g, (char) => char.toUpperCase());

  const badgeClass = (category) => `bl-badge bl-badge-${category || 'pending'}`;

  const createElement = (tag, className, text) => {
    const element = document.createElement(tag);
    if (className) element.className = className;
    if (text !== undefined && text !== null) element.textContent = text;
    return element;
  };

  const createUrlLink = (url, className = '') => {
    if (!url) return createElement('span', className, '—');
    const link = document.createElement('a');
    link.className = className;
    link.href = url;
    link.target = '_blank';
    link.rel = 'noopener noreferrer';
    link.textContent = url;
    link.title = url;
    return link;
  };

  const setBusy = (busy) => {
    startBtn.disabled = busy;
    startSpinner.classList.toggle('d-none', !busy);
    startIcon.classList.toggle('d-none', busy);
    startBtnText.textContent = busy ? 'Starting...' : 'Start Analysis';
  };

  const hideUrlError = () => {
    urlError.textContent = '';
    urlError.classList.add('d-none');
    websiteUrl.classList.remove('is-invalid');
  };

  const showUrlError = (message) => {
    urlError.textContent = message;
    urlError.classList.remove('d-none');
    websiteUrl.classList.add('is-invalid');
  };

  const getMode = () => {
    const selected = modeInputs.find((input) => input.checked);
    return selected?.value === 'sitemap' ? 'sitemap' : 'page';
  };

  const getScope = () => {
    const selected = scopeInputs
      .filter((input) => input.checked)
      .map((input) => input.value);
    const includesInternal = selected.includes('internal');
    const includesExternal = selected.includes('external');
    if (includesInternal && includesExternal) return 'both';
    if (includesInternal) return 'internal';
    if (includesExternal) return 'external';
    return 'both';
  };

  const updateUrlHint = () => {
    if (!urlHint) return;
    const isSitemap = getMode() === 'sitemap';
    const scope = getScope();
    if (isSitemap) {
      urlHint.textContent =
        scope === 'internal'
          ? 'We will crawl every page in this sitemap and check internal links.'
          : scope === 'external'
            ? 'We will crawl every page in this sitemap and check external links.'
            : 'We will crawl every page in this sitemap and check internal and external links.';
      return;
    }
    urlHint.textContent =
      scope === 'internal'
        ? 'Only links to this website found on this page will be checked.'
        : scope === 'external'
          ? 'Only links to other websites found on this page will be checked.'
          : 'Every internal and external link found on this page will be checked.';
  };

  const applyScope = () => {
    scopeOptions.forEach((option) => {
      const input = option.querySelector('input[name="linkScope"]');
      option.classList.toggle('scope-option--active', Boolean(input?.checked));
    });
    updateUrlHint();
  };

  const applyMode = () => {
    const mode = getMode();
    const isSitemap = mode === 'sitemap';
    modeOptions.forEach((option) => {
      option.classList.toggle(
        'scope-option--active',
        option.dataset.mode === mode,
      );
    });
    if (urlLabelText) {
      urlLabelText.textContent = isSitemap ? 'Sitemap URL' : 'Page URL';
    }
    websiteUrl.placeholder = isSitemap
      ? 'https://example.com/sitemap.xml'
      : 'https://example.com/page';
    updateUrlHint();
    hideUrlError();
  };

  const validateUrl = (value, mode) => {
    if (!value) {
      return mode === 'sitemap'
        ? 'Enter a sitemap URL to audit.'
        : 'Enter a page URL to audit.';
    }
    let parsed;
    try {
      parsed = new URL(value);
    } catch {
      return 'Enter a valid URL including http:// or https://.';
    }
    if (parsed.protocol !== 'http:' && parsed.protocol !== 'https:') {
      return 'Only HTTP and HTTPS URLs are supported.';
    }
    if (!parsed.hostname) return 'The URL must include a hostname.';
    return null;
  };

  const readErrorMessage = (payload, fallback) => {
    if (!payload) return fallback;
    if (Array.isArray(payload.message)) return payload.message.join(' ');
    if (typeof payload.message === 'string') return payload.message;
    if (typeof payload.error === 'string') return payload.error;
    return fallback;
  };

  const updateProgress = (snapshot) => {
    const stats = snapshot.stats;
    const isChecking =
      typeof snapshot.currentPage === 'string' &&
      (snapshot.currentPage.startsWith('Checking ') ||
        snapshot.currentPage === 'Preparing link checks');

    let statusLabel = 'Processing';
    if (snapshot.status === 'queued') statusLabel = 'Queued';
    if (snapshot.status === 'completed') statusLabel = 'Completed';
    if (snapshot.status === 'failed' || snapshot.status === 'cancelled') {
      statusLabel = 'Error';
    }

    statusIndicator.className = 'status-indicator';
    if (snapshot.status === 'running' || snapshot.status === 'queued') {
      statusIndicator.classList.add('active');
    } else if (snapshot.status === 'completed') {
      statusIndicator.classList.add('completed');
    } else if (
      snapshot.status === 'failed' ||
      snapshot.status === 'cancelled'
    ) {
      statusIndicator.classList.add('error');
    }

    statusText.textContent = statusLabel;
    statusDetail.textContent =
      snapshot.currentPage ||
      (snapshot.config.mode === 'sitemap'
        ? `Sitemap: ${snapshot.config.url}`
        : snapshot.config.url);

    let progress = 0;
    if (snapshot.status === 'completed') {
      progress = 100;
    } else if (isChecking) {
      progress = stats.linksDiscovered
        ? (stats.linksChecked / stats.linksDiscovered) * 100
        : 0;
    } else {
      progress = stats.pagesDiscovered
        ? (stats.pagesCrawled / stats.pagesDiscovered) * 100
        : 0;
    }
    auditProgressBar.style.width = `${Math.max(0, Math.min(100, progress))}%`;

    summaryPages.textContent = formatNumber(stats.pagesCrawled);
    summaryChecked.textContent = formatNumber(stats.linksChecked);
    summaryHealthy.textContent = formatNumber(stats.healthyLinks);
    summaryBroken.textContent = formatNumber(stats.brokenLinks);

    if (stats.linksDiscovered > 0 || snapshot.status === 'completed') {
      resultsCard.classList.remove('d-none');
    }
  };

  const closeSse = () => {
    if (state.sse) {
      state.sse.close();
      state.sse = null;
    }
  };

  const stopPolling = () => {
    if (state.pollTimer) {
      clearInterval(state.pollTimer);
      state.pollTimer = null;
    }
  };

  const startPolling = () => {
    stopPolling();
    state.pollTimer = setInterval(async () => {
      if (!state.auditId) return;
      try {
        const response = await fetch(
          `/broken-links/${encodeURIComponent(state.auditId)}`,
        );
        if (!response.ok) throw new Error('Unable to fetch audit status.');
        const snapshot = await response.json();
        handleSnapshot(snapshot);
      } catch (error) {
        stopPolling();
        notify('error', error.message);
      }
    }, 1200);
  };

  const handleTerminal = (snapshot) => {
    closeSse();
    stopPolling();
    cancelBtn.classList.add('d-none');

    if (snapshot.status === 'failed') {
      auditErrorBox.classList.remove('d-none');
      auditErrorMessage.textContent =
        snapshot.error || 'The audit could not be completed.';
      notify('error', snapshot.error || 'The audit failed.');
    } else {
      auditErrorBox.classList.add('d-none');
      if (snapshot.status === 'cancelled') {
        notify('warning', 'Audit cancelled. Partial results are available.');
      } else {
        notify(
          'success',
          `Audit complete. ${formatNumber(snapshot.stats.brokenLinks)} broken link${snapshot.stats.brokenLinks === 1 ? '' : 's'} found.`,
        );
      }
    }

    loadResults();
  };

  const handleSnapshot = (snapshot) => {
    if (!snapshot) return;
    state.snapshot = snapshot;
    updateProgress(snapshot);

    const terminal =
      snapshot.status === 'completed' ||
      snapshot.status === 'failed' ||
      snapshot.status === 'cancelled';

    if (terminal && !state.terminal) {
      state.terminal = true;
      handleTerminal(snapshot);
      return;
    }

    if (
      !terminal &&
      snapshot.stats.linksChecked > 0 &&
      !state.resultLoading &&
      Date.now() - state.lastResultFetch > 1500
    ) {
      loadResults();
    }
  };

  const connectSse = () => {
    closeSse();
    if (!state.auditId) return;
    const source = new EventSource(
      `/broken-links/${encodeURIComponent(state.auditId)}/stream`,
    );
    state.sse = source;

    source.onmessage = (event) => {
      let payload;
      try {
        payload = JSON.parse(event.data);
      } catch {
        return;
      }
      if (payload.type === 'error') {
        closeSse();
        notify('error', payload.message || 'Audit stream error.');
        return;
      }
      if (payload.type === 'progress') {
        handleSnapshot(payload);
      }
    };

    source.onerror = () => {
      if (state.terminal) {
        closeSse();
        return;
      }
      closeSse();
      startPolling();
    };
  };

  const startAudit = async (event) => {
    event.preventDefault();
    if (state.auditId && !state.terminal) return;

    hideUrlError();
    const mode = getMode();
    const target = websiteUrl.value.trim();
    const validationError = validateUrl(target, mode);
    if (validationError) {
      showUrlError(validationError);
      notify('error', validationError);
      websiteUrl.focus();
      return;
    }

    setBusy(true);
    state.terminal = false;
    setupCard.classList.add('d-none');
    resultsCard.classList.remove('d-none');
    loadingResults.classList.remove('d-none');
    auditErrorBox.classList.add('d-none');
    resultsTableBody.replaceChildren();
    emptyResults.classList.add('d-none');
    cancelBtn.classList.add('d-none');
    exportBtn.classList.add('d-none');
    newAuditBtn.classList.add('d-none');
    statusIndicator.className = 'status-indicator active';
    statusText.textContent = 'Starting audit...';
    statusDetail.textContent = 'Preparing crawler';
    auditProgressBar.style.width = '0%';

    try {
      const response = await fetch('/broken-links', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          mode,
          scope: getScope(),
          ...(mode === 'sitemap' ? { sitemapUrl: target } : { url: target }),
        }),
      });

      const payload = await response.json().catch(() => null);
      if (!response.ok) {
        throw new Error(
          readErrorMessage(payload, 'Unable to start the audit.'),
        );
      }

      state.auditId = payload.id;
      state.snapshot = payload;
      state.resultsLoadedOnce = false;
      cancelBtn.classList.remove('d-none');
      cancelBtn.disabled = false;
      exportBtn.classList.remove('d-none');
      newAuditBtn.classList.remove('d-none');
      updateProgress(payload);
      connectSse();
      notify(
        'info',
        mode === 'sitemap'
          ? 'Audit started. Reading the sitemap now.'
          : 'Audit started. Checking this page now.',
      );
    } catch (error) {
      setupCard.classList.remove('d-none');
      resultsCard.classList.add('d-none');
      loadingResults.classList.add('d-none');
      notify('error', error.message);
    } finally {
      setBusy(false);
    }
  };

  const cancelAudit = async () => {
    if (!state.auditId || state.terminal) return;
    if (!window.confirm('Cancel this audit? Partial results will be kept.')) {
      return;
    }

    cancelBtn.disabled = true;
    try {
      const response = await fetch(
        `/broken-links/${encodeURIComponent(state.auditId)}/cancel`,
        { method: 'POST' },
      );
      const payload = await response.json().catch(() => null);
      if (!response.ok) {
        throw new Error(
          readErrorMessage(payload, 'Unable to cancel the audit.'),
        );
      }
      handleSnapshot(payload);
    } catch (error) {
      cancelBtn.disabled = false;
      notify('error', error.message);
    }
  };

  const buildResultParams = () => {
    const params = new URLSearchParams();
    params.set('status', state.status);
    params.set('linkType', state.linkType);
    params.set('sortBy', state.sortBy);
    params.set('sortDir', state.sortDir);
    return params;
  };

  const statusPresentation = (category) => {
    switch (category) {
      case 'healthy':
        return {
          label: 'Healthy',
          className: 'badge-matched',
          icon: 'bi-check-circle',
        };
      case 'redirect':
        return {
          label: 'Redirect',
          className: 'badge-warning',
          icon: 'bi-arrow-repeat',
        };
      case 'unverified':
        return {
          label: 'Unverified',
          className: 'badge-warning',
          icon: 'bi-question-circle',
        };
      case 'pending':
        return {
          label: 'Pending',
          className: 'badge-warning',
          icon: 'bi-hourglass-split',
        };
      case 'restricted':
        return {
          label: 'Restricted',
          className: 'badge-missing',
          icon: 'bi-shield-exclamation',
        };
      case 'server_error':
        return {
          label: 'Server Error',
          className: 'badge-missing',
          icon: 'bi-server',
        };
      case 'broken':
        return {
          label: 'Broken',
          className: 'badge-missing',
          icon: 'bi-x-circle',
        };
      default:
        return {
          label: category ? humanizeIssue(category) : 'Unknown',
          className: 'badge-warning',
          icon: 'bi-question-circle',
        };
    }
  };

  const createStatusBadge = (category) => {
    const meta = statusPresentation(category);
    const badge = createElement('span', meta.className);
    const icon = document.createElement('i');
    icon.className = `bi ${meta.icon}`;
    badge.appendChild(icon);
    badge.appendChild(document.createTextNode(` ${meta.label}`));
    return badge;
  };

  const createDetailsButton = (id) => {
    const button = document.createElement('button');
    button.type = 'button';
    button.className = 'btn-view-details';
    button.dataset.action = 'details';
    button.dataset.id = id;
    const icon = document.createElement('i');
    icon.className = 'bi bi-info-circle';
    button.appendChild(icon);
    button.appendChild(document.createTextNode(' View Details'));
    return button;
  };

  const renderResultRow = (row) => {
    const tr = document.createElement('tr');
    tr.dataset.id = row.id;

    const sourceCell = document.createElement('td');
    sourceCell.className = 'url-cell';
    sourceCell.title = row.sourcePage || '';
    sourceCell.appendChild(createUrlLink(row.sourcePage));
    tr.appendChild(sourceCell);

    const destinationCell = document.createElement('td');
    destinationCell.className = 'url-cell';
    destinationCell.title = row.destinationUrl || '';
    destinationCell.appendChild(createUrlLink(row.destinationUrl));
    tr.appendChild(destinationCell);

    const statusCell = document.createElement('td');
    statusCell.appendChild(createStatusBadge(row.category));
    tr.appendChild(statusCell);

    const issueCell = document.createElement('td');
    issueCell.className = 'issue-cell';
    if (row.category === 'healthy' || row.issueType === 'none') {
      issueCell.appendChild(createElement('span', 'issue-none', 'No issues'));
    } else {
      const issueBadge = createElement(
        'span',
        'issue-badge',
        humanizeIssue(row.issueType),
      );
      issueBadge.title = row.error || humanizeIssue(row.issueType);
      issueCell.appendChild(issueBadge);
    }
    issueCell.appendChild(createDetailsButton(row.id));
    tr.appendChild(issueCell);

    return tr;
  };

  const loadResults = async () => {
    if (!state.auditId) return;
    if (state.resultAbort) state.resultAbort.abort();
    const controller = new AbortController();
    state.resultAbort = controller;
    state.resultLoading = true;

    if (!state.resultsLoadedOnce) {
      loadingResults.classList.remove('d-none');
    }

    try {
      const params = buildResultParams();
      params.set('pageSize', '20000');
      const response = await fetch(
        `/broken-links/${encodeURIComponent(state.auditId)}/results?${params.toString()}`,
        { signal: controller.signal },
      );
      if (!response.ok) {
        throw new Error('Unable to load audit results.');
      }
      const data = await response.json();
      if (state.resultAbort !== controller) return;

      resultsTableBody.replaceChildren();
      const fragment = document.createDocumentFragment();
      data.items.forEach((row) => fragment.appendChild(renderResultRow(row)));
      resultsTableBody.appendChild(fragment);

      const filtersActive = state.status !== 'all' || state.linkType !== 'all';

      if (data.items.length === 0) {
        emptyResults.classList.remove('d-none');
        if (state.snapshot && state.snapshot.stats.linksDiscovered === 0) {
          emptyResultsText.textContent =
            'No links were discovered on the pages that were crawled.';
        } else if (filtersActive) {
          emptyResultsText.textContent = 'No links match the current filters.';
        } else {
          emptyResultsText.textContent = 'No link results are available yet.';
        }
      } else {
        emptyResults.classList.add('d-none');
      }

      resultsCount.textContent = `${formatNumber(data.total)} link${data.total === 1 ? '' : 's'}`;
      state.resultsLoadedOnce = true;
      state.lastResultFetch = Date.now();
      resultsCard.classList.remove('d-none');
    } catch (error) {
      if (error.name !== 'AbortError') {
        notify('error', error.message);
      }
    } finally {
      if (state.resultAbort === controller) {
        state.resultLoading = false;
        loadingResults.classList.add('d-none');
      }
    }
  };

  const openDetail = async (resultId) => {
    if (!state.auditId) return;
    state.detailId = resultId;
    detailOverlay.classList.remove('d-none');
    detailPanel.classList.add('open');
    detailPanel.setAttribute('aria-hidden', 'false');
    detailBody.replaceChildren();

    const loading = createElement('div', 'bl-empty-state');
    const spinner = createElement('div', 'spinner-border text-primary');
    spinner.setAttribute('role', 'status');
    loading.appendChild(spinner);
    loading.appendChild(
      createElement('p', 'mt-3 mb-0', 'Loading diagnostics...'),
    );
    detailBody.appendChild(loading);

    try {
      const response = await fetch(
        `/broken-links/${encodeURIComponent(state.auditId)}/results/${encodeURIComponent(resultId)}`,
      );
      const payload = await response.json().catch(() => null);
      if (!response.ok) {
        throw new Error(
          readErrorMessage(payload, 'Unable to load link details.'),
        );
      }
      if (state.detailId !== resultId) return;
      renderDetail(payload);
    } catch (error) {
      if (state.detailId !== resultId) return;
      detailBody.replaceChildren();
      const errorBox = createElement(
        'div',
        'error-section d-flex align-items-start gap-2',
      );
      const icon = createElement('i', 'bi bi-exclamation-octagon-fill');
      const wrapper = document.createElement('div');
      wrapper.appendChild(
        createElement('strong', null, 'Could not load details'),
      );
      wrapper.appendChild(createElement('p', 'mb-0', error.message));
      errorBox.appendChild(icon);
      errorBox.appendChild(wrapper);
      detailBody.appendChild(errorBox);
    }
  };

  const renderDetail = (detail) => {
    const row = detail.result;
    detailBody.replaceChildren();

    const summarySection = createElement('div', 'bl-detail-section');
    summarySection.appendChild(createElement('h3', null, 'Status'));
    const summaryRow = createElement(
      'div',
      'd-flex flex-wrap gap-2 align-items-center',
    );
    summaryRow.appendChild(
      createElement(
        'span',
        badgeClass(row.category),
        humanizeIssue(row.issueType),
      ),
    );
    summaryRow.appendChild(
      createElement(
        'span',
        'bl-badge bl-badge-pending',
        row.status === null ? 'No HTTP status' : `HTTP ${row.status}`,
      ),
    );
    summaryRow.appendChild(
      createElement(
        'span',
        'bl-badge bl-badge-pending',
        row.linkType === 'internal' ? 'Internal link' : 'External link',
      ),
    );
    summarySection.appendChild(summaryRow);
    if (row.checkedAt) {
      summarySection.appendChild(
        createElement(
          'p',
          'text-muted small mt-2 mb-0',
          `Checked ${new Date(row.checkedAt).toLocaleString()}`,
        ),
      );
    }
    detailBody.appendChild(summarySection);

    const addValueSection = (title, value, isUrl = false) => {
      const section = createElement('div', 'bl-detail-section');
      section.appendChild(createElement('h3', null, title));
      if (isUrl && value) {
        section.appendChild(createUrlLink(value, 'bl-detail-value'));
      } else {
        section.appendChild(
          createElement('div', 'bl-detail-value', value || '—'),
        );
      }
      detailBody.appendChild(section);
    };

    addValueSection('Source page', row.sourcePage, true);
    addValueSection('Destination URL', row.destinationUrl, true);
    addValueSection('Link text', row.anchorText || '(no anchor text)');
    addValueSection('Final URL', row.finalUrl, true);

    const redirectSection = createElement('div', 'bl-detail-section');
    redirectSection.appendChild(createElement('h3', null, 'Redirect chain'));
    if (row.redirectChain && row.redirectChain.length > 0) {
      const list = createElement('div', 'bl-redirect-list');
      row.redirectChain.forEach((hop, index) => {
        const item = createElement('div', 'bl-redirect-hop');
        item.appendChild(
          createElement(
            'div',
            'fw-bold',
            `Hop ${index + 1} · HTTP ${hop.status}`,
          ),
        );
        item.appendChild(createElement('div', null, hop.url));
        if (hop.location) {
          const arrow = createElement('div', 'text-muted', '→ ');
          arrow.appendChild(createElement('span', null, hop.location));
          item.appendChild(arrow);
        }
        list.appendChild(item);
      });
      redirectSection.appendChild(list);
    } else {
      redirectSection.appendChild(
        createElement(
          'div',
          'bl-detail-value',
          'No redirects were recorded for this destination.',
        ),
      );
    }
    detailBody.appendChild(redirectSection);

    addValueSection(
      'Error details',
      row.error || 'No error details were reported for this destination.',
    );

    if (detail.relatedSources && detail.relatedSources.length > 0) {
      const relatedSection = createElement('div', 'bl-detail-section');
      relatedSection.appendChild(
        createElement(
          'h3',
          null,
          `Pages linking here (${detail.relatedSources.length})`,
        ),
      );
      const list = createElement('div', 'bl-related-list');
      detail.relatedSources.forEach((source) => {
        const item = createElement('div', 'bl-related-item');
        item.appendChild(createElement('strong', null, source.sourcePage));
        item.appendChild(
          createElement(
            'span',
            'text-muted',
            source.anchorText
              ? `Anchor: ${source.anchorText}`
              : 'No anchor text',
          ),
        );
        list.appendChild(item);
      });
      relatedSection.appendChild(list);
      detailBody.appendChild(relatedSection);
    }
  };

  const closeDetail = () => {
    state.detailId = null;
    detailPanel.classList.remove('open');
    detailPanel.setAttribute('aria-hidden', 'true');
    setTimeout(() => {
      if (!detailPanel.classList.contains('open')) {
        detailOverlay.classList.add('d-none');
      }
    }, 260);
  };

  const resetAudit = async () => {
    if (state.auditId && !state.terminal) {
      if (
        !window.confirm('An audit is running. Cancel it and start a new audit?')
      ) {
        return;
      }
      try {
        await fetch(
          `/broken-links/${encodeURIComponent(state.auditId)}/cancel`,
          { method: 'POST' },
        );
      } catch {
        // Reset the UI even if the cancel request fails.
      }
    }

    closeSse();
    stopPolling();
    if (state.resultAbort) state.resultAbort.abort();

    state.auditId = null;
    state.snapshot = null;
    state.terminal = false;
    state.resultsLoadedOnce = false;
    state.resultLoading = false;
    state.status = 'all';
    state.linkType = 'all';
    state.sortBy = 'sourcePage';
    state.sortDir = 'asc';
    state.lastResultFetch = 0;

    resultsTableBody.replaceChildren();
    emptyResults.classList.add('d-none');
    loadingResults.classList.add('d-none');
    resultsCard.classList.add('d-none');
    auditErrorBox.classList.add('d-none');
    cancelBtn.classList.add('d-none');
    cancelBtn.disabled = false;
    exportBtn.classList.remove('d-none');
    newAuditBtn.classList.remove('d-none');
    setupCard.classList.remove('d-none');
    auditForm.reset();
    applyMode();
    applyScope();
    hideUrlError();
    setBusy(false);
    statusFilterButtons.forEach((button) => {
      button.classList.toggle('active', button.dataset.status === 'all');
    });
    websiteUrl.focus();
  };

  const exportReport = () => {
    if (!state.auditId) return;
    const params = buildResultParams();
    window.location.href = `/broken-links/${encodeURIComponent(state.auditId)}/export?${params.toString()}`;
    notify('info', 'Preparing Excel export...');
  };

  auditForm.addEventListener('submit', startAudit);
  modeInputs.forEach((input) => {
    input.addEventListener('change', () => {
      applyMode();
    });
  });
  scopeInputs.forEach((input) => {
    input.addEventListener('change', () => {
      if (!scopeInputs.some((item) => item.checked)) {
        input.checked = true;
        notify('error', 'Select at least one link scope.');
      }
      applyScope();
    });
  });
  websiteUrl.addEventListener('input', hideUrlError);
  cancelBtn.addEventListener('click', cancelAudit);
  newAuditBtn.addEventListener('click', resetAudit);
  exportBtn.addEventListener('click', exportReport);
  closeDetailBtn.addEventListener('click', closeDetail);
  detailOverlay.addEventListener('click', closeDetail);

  statusFilterButtons.forEach((button) => {
    button.addEventListener('click', () => {
      state.status = button.dataset.status;
      statusFilterButtons.forEach((item) => {
        item.classList.toggle('active', item === button);
      });
      loadResults();
    });
  });

  resultsTableBody.addEventListener('click', (event) => {
    const button = event.target.closest('[data-action="details"]');
    if (!button) return;
    openDetail(button.dataset.id);
  });

  document.addEventListener('keydown', (event) => {
    if (event.key === 'Escape' && detailPanel.classList.contains('open')) {
      closeDetail();
    }
  });

  window.addEventListener('beforeunload', () => {
    closeSse();
    stopPolling();
    if (state.resultAbort) state.resultAbort.abort();
  });

  applyMode();
  applyScope();
});
