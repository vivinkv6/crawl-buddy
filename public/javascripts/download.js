let selectedFormat = 'json';

function showFormatSelectionModal() {
    const modalHtml = `
        <div class="modal fade" id="formatSelectionModal" tabindex="-1" aria-hidden="true">
            <div class="modal-dialog modal-dialog-centered">
                <div class="modal-content">
                    <div class="modal-header">
                        <h5 class="modal-title">Select Download Format</h5>
                        <button type="button" class="btn-close" data-bs-dismiss="modal" aria-label="Close"></button>
                    </div>
                    <div class="modal-body">
                        <div class="d-grid gap-3">
                            <button class="btn btn-outline-primary format-option" data-format="json">
                                <i class="bi bi-file-earmark-code"></i> JSON
                                <small class="d-block text-muted">Download all data in a single JSON file</small>
                            </button>
                            <button class="btn btn-outline-success format-option" data-format="xlsx">
                                <i class="bi bi-file-earmark-spreadsheet"></i> Excel
                                <small class="d-block text-muted">Download data in separate sheets (Meta, Videos, Images)</small>
                            </button>
                        </div>
                    </div>
                </div>
            </div>
        </div>
    `;

    // Remove existing modal if any
    const existingModal = document.getElementById('formatSelectionModal');
    if (existingModal) {
        existingModal.remove();
    }

    // Add modal to body
    document.body.insertAdjacentHTML('beforeend', modalHtml);

    // Initialize modal
    const modal = new bootstrap.Modal(document.getElementById('formatSelectionModal'));

    // Add click handlers for format options
    document.querySelectorAll('.format-option').forEach(button => {
        button.addEventListener('click', () => {
            selectedFormat = button.dataset.format;
            modal.hide();
            // Get download data and start download process
            const downloadButton = document.querySelector('#downloadButton');
            const downloadData = downloadButton.getAttribute('data-download');
            if (downloadData) {
                const parsedData = JSON.parse(downloadData);
                initiateDownload(parsedData.data, parsedData.contentType, parsedData.scrapeScope);
            } else {
                const notificationSystem = new NotificationSystem();
                notificationSystem.error('No data available for download');
            }
        });
    });

    return modal;
}

async function initiateDownload(data, contentType, scrapeScope) {
    let originalButtonText = '';
    let downloadButton = document.querySelector('#downloadButton');
    let scrapeButton = document.querySelector('#scrapeButton');
    const notificationSystem = new NotificationSystem();

    // Show initial download notification
    notificationSystem.info('Starting download process...', 3000);

    const updateButtonState = (state) => {
        downloadButton = document.querySelector('#downloadButton');
        scrapeButton = document.querySelector('#scrapeButton');
        
        if (!downloadButton) return;
    
        switch (state) {
            case 'downloading':
                downloadButton.disabled = true;
                downloadButton.classList.remove('d-none');
                downloadButton.innerHTML = '<i class="bi bi-hourglass-split"></i> Downloading...';
                if (scrapeButton) {
                    scrapeButton.disabled = true;
                }
                notificationSystem.info('Downloading scraped data...', 4000);
                break;
            case 'processing':
                downloadButton.disabled = true;
                downloadButton.classList.remove('d-none');
                downloadButton.innerHTML = '<i class="bi bi-cloud-download"></i> Processing...';
                if (scrapeButton) {
                    scrapeButton.disabled = true;
                }
                notificationSystem.info('Processing your download...', 3000);
                break;
            case 'success':
                downloadButton.disabled = false;
                downloadButton.classList.remove('d-none');
                downloadButton.innerHTML = '<i class="bi bi-check-circle"></i> Downloaded!';
                if (scrapeButton) {
                    scrapeButton.disabled = false;
                }
                notificationSystem.success('Download completed successfully!', 3000);
                break;
            case 'error':
                downloadButton.disabled = false;
                downloadButton.classList.remove('d-none');
                downloadButton.innerHTML = originalButtonText || '<i class="bi bi-download"></i> Download';
                if (scrapeButton) {
                    scrapeButton.disabled = false;
                }
                notificationSystem.error('An error occurred during download.');
                break;
            default:
                downloadButton.disabled = false;
                downloadButton.classList.remove('d-none');
                downloadButton.innerHTML = originalButtonText || '<i class="bi bi-download"></i> Download';
                if (scrapeButton) {
                    scrapeButton.disabled = false;
                }
        }
    };

    try {
        if (downloadButton) {
            originalButtonText = downloadButton.innerHTML;
            updateButtonState('downloading');
            downloadButton.classList.remove('d-none');
        }

        if (scrapeButton) {
            scrapeButton.disabled = true;
        }

        // Prepare download data
        const downloadData = {
            data,
            contentType,
            scrapeScope,
            format: selectedFormat,
            separateFiles: true
        };

        const response = await fetch('/scraper/download', {
            method: 'POST',
            headers: {
                'Content-Type': 'application/json'
            },
            body: JSON.stringify(downloadData)
        });

        if (!response.ok) {
            throw new Error(`HTTP error! status: ${response.status}`);
        }

        updateButtonState('processing');

        const blob = await response.blob();
        const url = window.URL.createObjectURL(blob);
        const a = document.createElement('a');
        a.href = url;
        
        // Set filename based on format and content
        const timestamp = new Date().toISOString().replace(/[:.]/g, '-');
        const filename = `scraped_data_${timestamp}.${selectedFormat === 'xlsx' ? 'xlsx' : 'zip'}`;
        a.download = filename;
        document.body.appendChild(a);
        a.click();
        window.URL.revokeObjectURL(url);
        document.body.removeChild(a);

            updateButtonState('success');
            setTimeout(() => {
                updateButtonState('default');
            }, 2000);
        

    } catch (error) {
        console.error('Download error:', error);
        notificationSystem.error('Failed to process data. Please try again.', 5000);
        updateButtonState('error');
        if (scrapeButton) {
            scrapeButton.disabled = false;
        }
    } finally {
        downloadButton = document.querySelector('#downloadButton');
        scrapeButton = document.querySelector('#scrapeButton');

        if (scrapeButton) {
            scrapeButton.disabled = false;
        }
    }
}


// Function to update progress UI
function updateProgress(data, container) {
    const progressBar = container.querySelector('.progress');
    const progressText = container.querySelector('.progress-text');
    const currentImage = container.querySelector('.current-image');
    const notificationSystem = new NotificationSystem();

    switch (data.type) {
        case 'progress':
            const percent = Math.round((data.downloaded / data.total) * 100);
            progressBar.style.width = `${percent}%`;
            progressText.textContent = `Downloading images: ${percent}%`;
            currentImage.textContent = `Current: ${data.currentImage}`;
            break;

        case 'error':
            notificationSystem.error(`Error downloading ${data.url}: ${data.error}`);
            break;

        case 'complete':
            progressText.textContent = data.message;
            notificationSystem.success('All images downloaded successfully!');
            setTimeout(() => {
                container.remove();
            }, 3000);
            break;
    }
}

// Function to show error messages
function showError(message) {
    const notificationSystem = new NotificationSystem();
    notificationSystem.error(message, 5000);
}