const urlInput = document.getElementById('url-input');
const loadBtn = document.getElementById('load-btn');
const statusEl = document.getElementById('status');
const previewPlaceholder = document.getElementById('preview-placeholder');
const addPacsBtn = document.getElementById('add-pacs-btn');
const pacsModal = document.getElementById('pacs-modal');
const pacsClose = document.getElementById('pacs-close');
const savePacsBtn = document.getElementById('save-pacs');
const showExistingBtn = document.getElementById('show-existing-pacs');
const viewPacsBtn = document.getElementById('view-pacs-btn');
const pacsListModal = document.getElementById('pacs-list-modal');
const pacsListClose = document.getElementById('pacs-list-close');
const pacsListRefresh = document.getElementById('pacs-list-refresh');
const pacsListBody = document.getElementById('pacs-list-body');
const eyeBtn = document.getElementById('eye-btn');

// Update status message
function updateStatus(message, isError = false) {
	statusEl.textContent = message;
	statusEl.style.color = isError ? '#d32f2f' : '#666';
}

// Show loading state
function setLoading(loading) {
	loadBtn.disabled = loading;
	loadBtn.textContent = loading ? 'Loading...' : 'Load Website';
}

// Hide/show preview placeholder
function togglePlaceholder(show) {
	previewPlaceholder.classList.toggle('hidden', !show);
}

// Load website
async function loadWebsite() {
	const url = urlInput.value.trim();

	if (!url) {
		updateStatus('Please enter a URL', true);
		return;
	}

	// Validate URL
	try {
		new URL(url);
	} catch {
		updateStatus('Please enter a valid URL', true);
		return;
	}

	setLoading(true);
	updateStatus('Loading website...');
	togglePlaceholder(false);

	try {
		await window.electronAPI.loadWebsite(url);
		updateStatus('Website loaded successfully');
	} catch (error) {
		updateStatus(`Error loading website: ${error.message}`, true);
		togglePlaceholder(true);
	} finally {
		setLoading(false);
	}
}

// Event listeners
loadBtn.addEventListener('click', loadWebsite);

urlInput.addEventListener('keypress', (e) => {
	if (e.key === 'Enter') {
		loadWebsite();
	}
});

// Handle Enter key in URL input
urlInput.addEventListener('keydown', (e) => {
	if (e.key === 'Enter') {
		e.preventDefault();
		loadWebsite();
	}
});

// Initial state
updateStatus('Enter a URL and click "Load Website" to preview');

// PACS Modal logic
function openPacsModal() {
	pacsModal.classList.add('open');
	// Suspend preview so it doesn't steal mouse/keyboard events
	window.electronAPI.previewSuspend();
}

function closePacsModal() {
	pacsModal.classList.remove('open');
	// Restore preview
	window.electronAPI.previewResume();
}

addPacsBtn.addEventListener('click', openPacsModal);
pacsClose.addEventListener('click', closePacsModal);

// Close on overlay click (but not when clicking inside modal)
pacsModal.addEventListener('click', (e) => {
	if (e.target === pacsModal) {
		closePacsModal();
	}
});

savePacsBtn.addEventListener('click', async () => {
	const node = document.getElementById('pacs-node').value.trim();
	const ip = document.getElementById('pacs-ip').value.trim();
	const port = document.getElementById('pacs-port').value.trim();
	const ae = document.getElementById('pacs-ae').value.trim();

	// For now, just show a status message. Later we can persist.
	if (!node || !ip || !port || !ae) {
		updateStatus('Please fill all PACS fields', true);
		return;
	}

	try {
		await window.electronAPI.savePacs({ node, ip, port, ae });
		updateStatus(`Saved PACS: ${node} (${ip}:${port}) AE=${ae}`);
		closePacsModal();
	} catch (e) {
		updateStatus('Failed to save PACS', true);
	}
});

showExistingBtn.addEventListener('click', async () => {
	try {
		const records = await window.electronAPI.listPacs();
		if (!records || records.length === 0) {
			updateStatus('Existing PACS: (none yet)');
			return;
		}
		const summary = records.map(r => `${r.node} (${r.ip}:${r.port}) AE=${r.ae}`).join(' | ');
		updateStatus(`Existing PACS: ${summary}`);
	} catch (e) {
		updateStatus('Failed to read PACS', true);
	}
});

// PACS list modal control
function openPacsList() {
	pacsListModal.classList.add('open');
	window.electronAPI.previewSuspend();
	refreshPacsList();
}

function closePacsList() {
	pacsListModal.classList.remove('open');
	window.electronAPI.previewResume();
}

async function refreshPacsList() {
	try {
		const records = await window.electronAPI.listPacs();
		if (!records || records.length === 0) {
			pacsListBody.innerHTML = '<tr><td colspan="5" style="text-align:center; color:#666; padding:16px;">No PACS added yet</td></tr>';
			return;
		}
		pacsListBody.innerHTML = records.map(r => `
			<tr>
				<td>${r.node}</td>
				<td>${r.ip}</td>
				<td>${r.port}</td>
				<td>${r.ae}</td>
				<td>
					<div class="pacs-actions">
						<button class="button btn-sm" data-edit="${r.id}">Edit</button>
					</div>
				</td>
			</tr>
		`).join('');

		// Attach edit handlers
		Array.from(pacsListBody.querySelectorAll('button[data-edit]')).forEach(btn => {
			btn.addEventListener('click', () => startEditPacs(btn.getAttribute('data-edit')));
		});
	} catch (e) {
		pacsListBody.innerHTML = '<tr><td colspan="4" style="color:#a00; padding:16px;">Failed to load PACS list</td></tr>';
	}
}

function startEditPacs(id) {
	const row = Array.from(pacsListBody.querySelectorAll('tr')).find(tr => {
		const b = tr.querySelector('button[data-edit]');
		return b && b.getAttribute('data-edit') === String(id);
	});
	if (!row) return;
	row.classList.add('editing');
	const cells = row.querySelectorAll('td');
	const [nodeTd, ipTd, portTd, aeTd, actTd] = cells;
	const node = nodeTd.textContent.trim();
	const ip = ipTd.textContent.trim();
	const port = portTd.textContent.trim();
	const ae = aeTd.textContent.trim();

	nodeTd.innerHTML = `<input value="${node}">`;
	ipTd.innerHTML = `<input value="${ip}">`;
	portTd.innerHTML = `<input type="number" value="${port}">`;
	aeTd.innerHTML = `<input value="${ae}">`;
	actTd.innerHTML = `
		<div class="pacs-actions">
			<button class="button btn-sm" data-save="${id}">Save</button>
			<button class="btn-secondary button btn-sm" data-cancel="${id}">Cancel</button>
		</div>
	`;

	actTd.querySelector('[data-save]').addEventListener('click', async () => {
		const updated = {
			id: Number(id),
			node: nodeTd.querySelector('input').value.trim(),
			ip: ipTd.querySelector('input').value.trim(),
			port: portTd.querySelector('input').value.trim(),
			ae: aeTd.querySelector('input').value.trim(),
		};
		if (!updated.node || !updated.ip || !updated.port || !updated.ae) {
			updateStatus('Please fill all fields to save PACS', true);
			return;
		}
		try {
			const res = await window.electronAPI.updatePacs(updated);
			if (res && res.ok) {
				updateStatus('PACS updated');
				refreshPacsList();
			} else {
				updateStatus('Failed to update PACS', true);
			}
		} catch {
			updateStatus('Failed to update PACS', true);
		}
	});

	actTd.querySelector('[data-cancel]').addEventListener('click', refreshPacsList);
}

viewPacsBtn.addEventListener('click', openPacsList);
pacsListClose.addEventListener('click', closePacsList);
pacsListRefresh.addEventListener('click', refreshPacsList);

eyeBtn.addEventListener('click', async () => {
	try {
		await window.electronAPI.triggerEye();
		updateStatus('Triggered image viewer');
	} catch (e) {
		updateStatus('Failed to trigger image viewer', true);
	}
});