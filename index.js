// ==UserScript==
// @name         Fmovies Netflix‑Style + VLC Shortcuts + Resume
// @namespace    http://tampermonkey.net/
// @version      10.2
// @description  Red border, black background, VLC shortcuts, help, poster, resume, back arrow, refined seek
// @author       You
// @match        https://new-fmovies.cam/*
// @grant        none
// ==/UserScript==

(function() {
    'use strict';

    // ----- Global state (existing + new) -----
    let currentStretch = 'uniform';
    let initialScrollDone = false;
    let activePopup = null;
    let progressKey = null;          // localStorage key for video progress
    let resumeNotification = null;   // reference to the resume notification element

    // ----- All helper functions (existing) -----
    function getMovieTitle() {
        const h1 = document.querySelector('h1.dDQVQruGpxUWtyFgNeqC');
        if (h1) return h1.innerText.trim();
        const titleMatch = document.title.match(/Fmovies\s*-\s*(.+?)(\s*in\s|\s*\||$)/);
        if (titleMatch) return titleMatch[1].trim();
        return 'video';
    }

    function sanitizeFilename(name) {
        return name.replace(/[^a-zA-Z0-9\-_() ]/g, '').trim();
    }

    function downloadFile(url, filename) {
        console.log(`⬇️ Downloading: ${filename}`);
        fetch(url, { mode: 'cors' })
            .then(response => {
                if (!response.ok) throw new Error(`HTTP ${response.status}`);
                return response.blob();
            })
            .then(blob => {
                const link = document.createElement('a');
                link.href = URL.createObjectURL(blob);
                link.download = filename;
                document.body.appendChild(link);
                link.click();
                document.body.removeChild(link);
                URL.revokeObjectURL(link.href);
                console.log(`✅ Downloaded: ${filename}`);
            })
            .catch(err => {
                console.warn(`❌ Failed to download ${filename}:`, err);
                console.log(`🔗 Opening ${url} in a new tab. Right‑click and choose "Save As".`);
                window.open(url, '_blank');
            });
    }

    function getVideoSrc() {
        const video = document.querySelector('video');
        if (!video) return null;
        const src = video.src;
        if (!src || src.startsWith('blob:')) return null;
        return src;
    }

    function getSubtitleSrc() {
        if (!window.subtitles || !Array.isArray(window.subtitles) || window.subtitles.length === 0) return null;
        const engTrack = window.subtitles.find(t => t.srclang === 'en' || t.label === 'English');
        return (engTrack || window.subtitles[0]).src;
    }

    function getBaseFilename() {
        return sanitizeFilename(getMovieTitle()) || 'video';
    }

    function downloadVideo() {
        const src = getVideoSrc();
        if (!src) { alert('No direct video URL found.'); return; }
        const base = getBaseFilename();
        const ext = src.split('.').pop().split('?')[0] || 'mp4';
        downloadFile(src, `${base}.${ext}`);
        closePopup('download');
    }

    function downloadSubtitles() {
        const src = getSubtitleSrc();
        if (!src) { alert('No subtitles found.'); return; }
        downloadFile(src, `${getBaseFilename()}.srt`);
        closePopup('download');
    }

    function getCurrentStretch() {
        const video = document.querySelector('video');
        if (!video) return currentStretch;
        const fit = video.style.objectFit || 'contain';
        if (fit === 'contain') return 'uniform';
        if (fit === 'cover') return 'fill';
        if (fit === 'fill') return 'exactfit';
        if (fit === 'none') return 'none';
        return 'uniform';
    }

    function setStretch(value) {
        const video = document.querySelector('video');
        if (!video) return;
        const map = { uniform: 'contain', fill: 'cover', exactfit: 'fill', none: 'none' };
        video.style.objectFit = map[value] || 'contain';
        try { jwplayer().setConfig({ stretch: value }); } catch(e) {}
        currentStretch = value;
    }

    function reapplyAspectRatio() {
        const video = document.querySelector('video');
        if (video && currentStretch) setStretch(currentStretch);
    }

    function getEpisodeLinks() {
        const container = document.querySelector('.yxJOwumKrLpwogNtEtdu, .UjYPcnlnHbWfyFUVZgFq');
        if (!container) return [];
        const links = container.querySelectorAll('a[href]');
        const episodes = [];
        links.forEach(link => {
            const text = link.textContent.trim();
            if (text && (text.includes('Episode') || text.includes('E') || /\d/.test(text))) {
                const season = link.closest('[data-season]')?.getAttribute('data-season') || 'Season 1';
                episodes.push({ element: link, text, season, href: link.href });
            }
        });
        return episodes;
    }

    function getCurrentEpisode() {
        const active = document.querySelector('.yxJOwumKrLpwogNtEtdu .jRmmVllQBlRmkCrJscHk, .UjYPcnlnHbWfyFUVZgFq .jRmmVllQBlRmkCrJscHk');
        return active ? active.textContent.trim() : null;
    }

    function openPlaylistPopup(anchor) {
        const eps = getEpisodeLinks();
        if (!eps.length) { alert('No episodes found.'); return; }
        const seasons = {};
        eps.forEach(ep => { if (!seasons[ep.season]) seasons[ep.season] = []; seasons[ep.season].push(ep); });
        const current = getCurrentEpisode();
        const content = [];
        for (const [season, list] of Object.entries(seasons)) {
            content.push({ label: `── ${season} ──`, action: null, selected: false, isHeader: true });
            list.forEach(ep => {
                content.push({
                    label: ep.text,
                    action: () => { ep.element.click(); closePopup('playlist'); },
                    selected: ep.text === current,
                    isHeader: false
                });
            });
        }
        openPopup('playlist', anchor, content);
    }

    function closePopup(type) {
        const popup = document.querySelector(`.popup-${type}`);
        if (popup) popup.remove();
        if (activePopup === type) {
            activePopup = null;
            document.removeEventListener('click', outsideClickHandler);
        }
    }

    function openPopup(type, anchor, content) {
        if (activePopup) closePopup(activePopup);
        const popup = document.createElement('div');
        popup.className = `popup-${type}`;
        Object.assign(popup.style, {
            position: 'absolute',
            bottom: 'calc(100% + 12px)',
            right: '0',
            backgroundColor: '#1a1a1a',
            border: '1px solid rgba(255,255,255,0.3)',
            borderRadius: '8px',
            padding: '6px 0',
            boxShadow: '0 8px 30px rgba(0,0,0,0.9)',
            minWidth: '220px',
            maxHeight: '400px',
            overflowY: 'auto',
            zIndex: '9999',
            color: 'white',
            fontFamily: 'Arial, sans-serif',
            fontSize: '14px'
        });

        content.forEach(item => {
            const div = document.createElement('div');
            if (item.isHeader) {
                div.textContent = item.label;
                Object.assign(div.style, {
                    padding: '8px 24px',
                    fontWeight: 'bold',
                    color: '#999',
                    fontSize: '12px',
                    textTransform: 'uppercase',
                    letterSpacing: '1px',
                    cursor: 'default'
                });
            } else {
                div.textContent = item.label;
                Object.assign(div.style, {
                    padding: '10px 24px',
                    cursor: 'pointer',
                    display: 'flex',
                    alignItems: 'center',
                    gap: '12px',
                    whiteSpace: 'nowrap',
                    transition: 'background 0.15s'
                });
                if (item.selected) {
                    div.style.backgroundColor = 'rgba(255,255,255,0.15)';
                    const check = document.createElement('span');
                    check.textContent = '✓';
                    check.style.marginLeft = 'auto';
                    check.style.fontWeight = 'bold';
                    check.style.color = '#E50914';
                    div.appendChild(check);
                }
                div.addEventListener('mouseenter', () => { if (!item.selected) div.style.backgroundColor = 'rgba(255,255,255,0.1)'; });
                div.addEventListener('mouseleave', () => { if (!item.selected) div.style.backgroundColor = 'transparent'; });
                div.addEventListener('click', (e) => { e.stopPropagation(); if (item.action) item.action(); });
            }
            popup.appendChild(div);
        });

        anchor.style.position = 'relative';
        anchor.appendChild(popup);
        activePopup = type;
        setTimeout(() => document.addEventListener('click', outsideClickHandler), 0);
    }

    function outsideClickHandler(e) {
        const btns = document.querySelectorAll('.custom-download-btn, .custom-aspect-btn, .custom-refocus-btn, .custom-playlist-btn, .custom-help-btn');
        let inside = false;
        btns.forEach(b => { if (b.contains(e.target)) inside = true; });
        if (!inside && activePopup) closePopup(activePopup);
    }

    function openAspectPopup(anchor) {
        const current = getCurrentStretch();
        const options = [
            { label: '📐  Fit (16:9)', value: 'uniform' },
            { label: '📐  Fill', value: 'fill' },
            { label: '📐  Stretch', value: 'exactfit' },
            { label: '📐  Original', value: 'none' }
        ];
        const content = options.map(opt => ({
            label: opt.label,
            action: () => { setStretch(opt.value); closePopup('aspect'); },
            selected: opt.value === current,
            isHeader: false
        }));
        openPopup('aspect', anchor, content);
    }

    function refocusPlayer() {
        const wrapper = document.querySelector('.aOTmRTniYzHzaHZrzLll');
        if (!wrapper) return;
        const rect = wrapper.getBoundingClientRect();
        window.scrollTo({ top: window.scrollY + rect.top, left: 0, behavior: 'smooth' });
    }

    function hidePremiumIcon() {
        const btn = document.querySelector('.jw-button-container .jw-icon-inline .jw-button-image[style*="premIco.png"]');
        if (btn) {
            const parent = btn.closest('.jw-icon-inline');
            if (parent) parent.style.display = 'none';
        }
    }

    function fitPlayerToViewport() {
        document.documentElement.style.margin = '0';
        document.documentElement.style.padding = '0';
        document.body.style.margin = '0';
        document.body.style.padding = '0';
        document.body.style.overflowX = 'hidden';

        const wrapper = document.querySelector('.aOTmRTniYzHzaHZrzLll');
        if (!wrapper) return;

        let parent = wrapper.parentElement;
        while (parent && parent !== document.body) {
            parent.style.margin = '0';
            parent.style.padding = '0';
            parent.style.width = '100%';
            parent.style.maxWidth = '100%';
            parent = parent.parentElement;
        }

        const vw = window.innerWidth;
        const vh = window.innerHeight;
        wrapper.style.width = vw + 'px';
        wrapper.style.height = vh + 'px';
        wrapper.style.maxWidth = '100%';
        wrapper.style.maxHeight = '100%';
        wrapper.style.margin = '0';
        wrapper.style.padding = '0';
        wrapper.style.position = 'relative';
        wrapper.style.overflow = 'hidden';

        const holder = wrapper.querySelector('.xGdsZlErPPBhpVHtfsgR');
        if (holder) {
            holder.style.width = '100%';
            holder.style.height = '100%';
            holder.style.margin = '0';
            holder.style.padding = '0';
        }

        const jw = wrapper.querySelector('.jwplayer');
        if (jw) {
            jw.style.width = '100%';
            jw.style.height = '100%';
        }
        return wrapper;
    }

    function scrollToPlayer() {
        const wrapper = document.querySelector('.aOTmRTniYzHzaHZrzLll');
        if (!wrapper) return;
        const rect = wrapper.getBoundingClientRect();
        window.scrollTo({ top: window.scrollY + rect.top, left: 0, behavior: 'auto' });
        initialScrollDone = true;
    }

    // ----- Subtitles styles (unchanged) -----
    function injectSubtitleStyles() {
        const style = document.createElement('style');
        style.id = 'custom-subtitle-styles';
        style.textContent = `
            .jw-captions .jw-text-track-cue,
            .jwplayer .jw-captions .jw-text-track-cue {
                font-family: 'Helvetica Neue', Arial, sans-serif !important;
                background: transparent !important;
                background-color: transparent !important;
                color: white !important;
                text-shadow: 0 0 10px rgba(0,0,0,0.9), 0 0 20px rgba(0,0,0,0.7), 2px 2px 4px rgba(0,0,0,0.8), -2px -2px 4px rgba(0,0,0,0.8) !important;
                padding: 0.1em 0.2em !important;
                border-radius: 0 !important;
                font-size: 1.2em !important;
                letter-spacing: 0.5px !important;
                opacity: 0 !important;
                transform: translateX(-20px) scale(1.02) !important;
                filter: blur(8px) !important;
                transition: opacity 0.4s cubic-bezier(0.2, 0.9, 0.3, 1),
                            transform 0.4s cubic-bezier(0.2, 0.9, 0.3, 1),
                            filter 0.4s cubic-bezier(0.2, 0.9, 0.3, 1) !important;
                will-change: transform, opacity, filter;
            }
            .jw-captions .jw-text-track-cue[style*="display: block"],
            .jw-captions .jw-text-track-cue:not([style*="display: none"]) {
                opacity: 1 !important;
                transform: translateX(0) scale(1) !important;
                filter: blur(0) !important;
            }
            .jw-captions-window { background: transparent !important; padding: 0 !important; }
            .jw-captions-text { background: transparent !important; text-shadow: 0 0 10px rgba(0,0,0,0.9), 0 0 20px rgba(0,0,0,0.7) !important; }
        `;
        document.head.appendChild(style);
    }

    // ----- Player Netflix CSS (extended) -----
    function injectNetflixCSS() {
        const style = document.createElement('style');
        style.textContent = `
            .jw-controlbar { background: linear-gradient(to bottom, transparent, rgba(0,0,0,0.85)) !important; padding: 0 16px !important; }
            .jw-slider-time .jw-rail { background: rgba(255,255,255,0.3) !important; height: 4px !important; }
            .jw-slider-time .jw-buffer { background: rgba(255,255,255,0.2) !important; }
            .jw-slider-time .jw-progress { background: #E50914 !important; height: 4px !important; }
            .jw-slider-time .jw-knob { background: #E50914 !important; box-shadow: 0 0 12px rgba(229,9,20,0.7) !important; width: 14px !important; height: 14px !important; top: 50% !important; transform: translate(-50%, -50%) scale(1) !important; }
            .jw-display-icon-display .jw-icon { background: rgba(0,0,0,0.6) !important; border-radius: 50% !important; width: 72px !important; height: 72px !important; transition: transform 0.2s ease !important; }
            .jw-display-icon-display .jw-icon:hover { transform: scale(1.1) !important; }
            .jw-display-icon-display .jw-svg-icon-play { fill: white !important; width: 32px !important; height: 32px !important; margin-left: 4px !important; }
            .jw-display-icon-display .jw-svg-icon-pause { fill: white !important; width: 32px !important; height: 32px !important; }
            .jw-controlbar .jw-title-display { color: white !important; font-size: 16px !important; font-weight: 500 !important; margin-right: 20px !important; white-space: nowrap !important; overflow: hidden !important; text-overflow: ellipsis !important; max-width: 250px !important; display: inline-block !important; vertical-align: middle !important; }
            .jw-icon-cc .jw-svg-icon-cc-on, .jw-icon-cc .jw-svg-icon-cc-off { display: none !important; }
            .jw-icon-cc::before { content: "CC"; font-family: Arial, sans-serif; font-weight: bold; font-size: 14px; color: white; background: rgba(0,0,0,0.5); padding: 2px 6px; border-radius: 4px; border: 1px solid rgba(255,255,255,0.3); display: inline-block; line-height: 1.2; }
            .jw-icon-cc.jw-off::before { opacity: 0.5; }
            .jw-icon-cc.jw-off:hover::before, .jw-icon-cc:hover::before { opacity: 1; }
            .jw-text-elapsed, .jw-text-duration, .jw-text-countdown { font-family: Arial, sans-serif !important; font-size: 14px !important; font-weight: 400 !important; letter-spacing: 0.5px !important; }
            .custom-download-btn, .custom-aspect-btn, .custom-refocus-btn, .custom-playlist-btn, .custom-help-btn {
                margin: 0 4px !important; padding: 0 6px !important; line-height: 1 !important; opacity: 0.8; transition: opacity 0.2s;
                cursor: pointer; display: inline-flex !important; align-items: center; justify-content: center;
                color: white !important; background: transparent !important; border: none !important;
                height: 44px !important; width: 44px !important; position: relative;
            }
            .custom-download-btn:hover, .custom-aspect-btn:hover, .custom-refocus-btn:hover, .custom-playlist-btn:hover, .custom-help-btn:hover { opacity: 1; }
            .custom-download-btn svg, .custom-aspect-btn svg, .custom-refocus-btn svg, .custom-playlist-btn svg, .custom-help-btn svg { width: 22px; height: 22px; fill: currentColor; }
            .jw-button-container { padding: 0 8px !important; }
            /* Poster background when video is idle or paused */
            .jwplayer.jw-state-idle .jw-media, .jwplayer.jw-state-paused .jw-media {
                background-size: cover !important;
                background-position: center !important;
                background-repeat: no-repeat !important;
            }
            /* Resume notification */
            .fm-resume-notification {
                position: absolute;
                bottom: 80px;
                left: 50%;
                transform: translateX(-50%);
                background: rgba(0,0,0,0.8);
                color: white;
                padding: 10px 24px;
                border-radius: 8px;
                font-family: Arial, sans-serif;
                font-size: 14px;
                z-index: 1000;
                display: none;
                border: 1px solid rgba(255,255,255,0.2);
                backdrop-filter: blur(4px);
                animation: fm-fadeInUp 0.3s ease;
            }
            .fm-resume-notification button {
                background: #E50914;
                border: none;
                color: white;
                padding: 4px 16px;
                border-radius: 4px;
                margin-left: 12px;
                cursor: pointer;
                font-weight: bold;
            }
            .fm-resume-notification button:hover {
                background: #f40612;
            }
            .fm-resume-notification .fm-close-resume {
                background: transparent;
                border: none;
                color: #aaa;
                margin-left: 12px;
                cursor: pointer;
                font-size: 18px;
                line-height: 1;
            }
            .fm-resume-notification .fm-close-resume:hover {
                color: white;
            }
            @keyframes fm-fadeInUp {
                from { opacity: 0; transform: translateX(-50%) translateY(20px); }
                to { opacity: 1; transform: translateX(-50%) translateY(0); }
            }
            /* Help popup (keyboard shortcuts) */
            .fm-help-popup {
                position: absolute;
                bottom: calc(100% + 12px);
                right: 0;
                background: #1a1a1a;
                border: 1px solid rgba(255,255,255,0.2);
                border-radius: 8px;
                padding: 16px 20px;
                min-width: 260px;
                box-shadow: 0 8px 30px rgba(0,0,0,0.9);
                color: white;
                font-family: Arial, sans-serif;
                font-size: 13px;
                z-index: 9999;
                display: none;
            }
            .fm-help-popup h4 {
                margin: 0 0 12px 0;
                font-size: 16px;
                border-bottom: 1px solid #333;
                padding-bottom: 8px;
            }
            .fm-help-popup table {
                width: 100%;
                border-collapse: collapse;
            }
            .fm-help-popup td {
                padding: 4px 8px;
                color: #ccc;
            }
            .fm-help-popup td:first-child {
                font-weight: bold;
                color: white;
                text-align: right;
                padding-right: 16px;
            }
            .fm-help-popup .fm-close-help {
                position: absolute;
                top: 8px;
                right: 12px;
                background: none;
                border: none;
                color: #aaa;
                font-size: 18px;
                cursor: pointer;
            }
            .fm-help-popup .fm-close-help:hover {
                color: white;
            }
            /* ---------- NEW: Back arrow ---------- */
            .fm-back-arrow {
                position: absolute;
                top: 20px;
                left: 20px;
                z-index: 1000;
                cursor: pointer;
                opacity: 0;
                transition: opacity 0.3s ease;
                background: rgba(0,0,0,0.6);
                border-radius: 50%;
                width: 44px;
                height: 44px;
                display: flex;
                align-items: center;
                justify-content: center;
                color: white;
                font-size: 26px;
                font-weight: bold;
                text-shadow: 0 0 10px rgba(0,0,0,0.8);
                border: none;
                outline: none;
                pointer-events: none; /* initially no pointer, enabled on hover */
            }
            .fm-back-arrow:hover {
                background: rgba(255,255,255,0.2);
                transform: scale(1.05);
            }
            .jwplayer:hover .fm-back-arrow {
                opacity: 1;
                pointer-events: auto;
            }
        `;
        document.head.appendChild(style);
    }

    // ----- SVG icons (existing + help) -----
    function createDownloadSVG() {
        const svg = document.createElementNS('http://www.w3.org/2000/svg', 'svg');
        svg.setAttribute('viewBox', '0 0 24 24');
        svg.setAttribute('focusable', 'false');
        svg.innerHTML = `<path d="M19 9h-4V3H9v6H5l7 7 7-7zM5 18v2h14v-2H5z"/>`;
        return svg;
    }

    function createAspectSVG() {
        const svg = document.createElementNS('http://www.w3.org/2000/svg', 'svg');
        svg.setAttribute('viewBox', '0 0 24 24');
        svg.setAttribute('focusable', 'false');
        svg.innerHTML = `<path d="M3 5v14h18V5H3zm2 2h14v10H5V7zm4 2v6h6V9H9zm2 2h2v2h-2v-2z"/>`;
        return svg;
    }

    function createRefocusSVG() {
        const svg = document.createElementNS('http://www.w3.org/2000/svg', 'svg');
        svg.setAttribute('viewBox', '0 0 24 24');
        svg.setAttribute('focusable', 'false');
        svg.innerHTML = `<path d="M12 2C8.13 2 5 5.13 5 9c0 5.25 7 13 7 13s7-7.75 7-13c0-3.87-3.13-7-7-7zm0 9.5c-1.38 0-2.5-1.12-2.5-2.5s1.12-2.5 2.5-2.5 2.5 1.12 2.5 2.5-1.12 2.5-2.5 2.5z"/>`;
        return svg;
    }

    function createPlaylistSVG() {
        const svg = document.createElementNS('http://www.w3.org/2000/svg', 'svg');
        svg.setAttribute('viewBox', '0 0 24 24');
        svg.setAttribute('focusable', 'false');
        svg.innerHTML = `<path d="M4 6h16v2H4V6zm0 4h10v2H4v-2zm0 4h16v2H4v-2zm0 4h10v2H4v-2z"/>`;
        return svg;
    }

    function createHelpSVG() {
        const svg = document.createElementNS('http://www.w3.org/2000/svg', 'svg');
        svg.setAttribute('viewBox', '0 0 24 24');
        svg.setAttribute('focusable', 'false');
        svg.innerHTML = `<path d="M12 2C6.48 2 2 6.48 2 12s4.48 10 10 10 10-4.48 10-10S17.52 2 12 2zm1 17h-2v-2h2v2zm2.07-7.75l-.9.92C13.45 12.9 13 13.5 13 15h-2v-.5c0-1.1.45-2.1 1.17-2.83l1.24-1.26c.37-.36.59-.86.59-1.41 0-1.1-.9-2-2-2s-2 .9-2 2H8c0-2.21 1.79-4 4-4s4 1.79 4 4c0 .88-.36 1.68-.93 2.25z"/>`;
        return svg;
    }

    // ----- Get gallery image -----
    function getGalleryImage() {
        // Try to find a gallery image from the page
        const galleryImages = document.querySelectorAll('.DVNtLyTexONtMJDxiJvH img, .WASuJMVnowRSrElddehA img');
        if (galleryImages.length > 0) {
            // Return the first image src (prefer landscape orientation)
            for (const img of galleryImages) {
                const src = img.src || img.getAttribute('data-src');
                if (src && src.startsWith('http')) return src;
            }
        }
        // Fallback: try poster image
        const poster = document.querySelector('.PmjILapOWIgZNOylXRAw img');
        if (poster) {
            const src = poster.src || poster.getAttribute('data-src');
            if (src && src.startsWith('http')) return src;
        }
        return null;
    }

    // ----- Progress saving and resume -----
    function getProgressKey() {
        if (!progressKey) {
            const url = window.location.href;
            // Use a hash of the URL to keep it short
            let hash = 0;
            for (let i = 0; i < url.length; i++) {
                hash = ((hash << 5) - hash) + url.charCodeAt(i);
                hash |= 0;
            }
            progressKey = `fm_progress_${Math.abs(hash)}`;
        }
        return progressKey;
    }

    function saveProgress(currentTime) {
        if (!currentTime || currentTime < 0) return;
        const key = getProgressKey();
        try {
            localStorage.setItem(key, JSON.stringify({ time: currentTime, updated: Date.now() }));
        } catch (e) {}
    }

    function getSavedProgress() {
        const key = getProgressKey();
        try {
            const raw = localStorage.getItem(key);
            if (!raw) return null;
            const data = JSON.parse(raw);
            return data.time || null;
        } catch (e) { return null; }
    }

    function clearSavedProgress() {
        const key = getProgressKey();
        try { localStorage.removeItem(key); } catch (e) {}
    }

    function showResumeNotification(savedTime) {
        // Remove existing notification
        const old = document.querySelector('.fm-resume-notification');
        if (old) old.remove();

        const player = document.querySelector('.jwplayer');
        if (!player) return;

        const notification = document.createElement('div');
        notification.className = 'fm-resume-notification';
        notification.innerHTML = `
            <span>⏱️ Resume from ${formatTime(savedTime)}?</span>
            <button class="fm-resume-yes">Resume</button>
            <button class="fm-resume-no">Start over</button>
            <button class="fm-close-resume">✕</button>
        `;
        player.appendChild(notification);
        notification.style.display = 'block';
        resumeNotification = notification;

        notification.querySelector('.fm-resume-yes').addEventListener('click', () => {
            seekToTime(savedTime);
            notification.style.display = 'none';
            resumeNotification = null;
            // Remove the notification after a delay
            setTimeout(() => notification.remove(), 500);
        });

        notification.querySelector('.fm-resume-no').addEventListener('click', () => {
            clearSavedProgress();
            notification.style.display = 'none';
            resumeNotification = null;
            setTimeout(() => notification.remove(), 500);
        });

        notification.querySelector('.fm-close-resume').addEventListener('click', () => {
            notification.style.display = 'none';
            resumeNotification = null;
            setTimeout(() => notification.remove(), 500);
        });
    }

    function formatTime(seconds) {
        const h = Math.floor(seconds / 3600);
        const m = Math.floor((seconds % 3600) / 60);
        const s = Math.floor(seconds % 60);
        if (h > 0) return `${h}:${String(m).padStart(2,'0')}:${String(s).padStart(2,'0')}`;
        return `${String(m).padStart(2,'0')}:${String(s).padStart(2,'0')}`;
    }

    function seekToTime(time) {
        const video = document.querySelector('video');
        if (video) {
            video.currentTime = time;
        }
        try {
            jwplayer().seek(time);
        } catch (e) {}
    }

    // ----- Keyboard shortcuts (VLC style, refined) -----
    function setupKeyboardShortcuts() {
        // Use capture phase to intercept before JW Player's default handler
        document.addEventListener('keydown', function(e) {
            // Ignore if focus is on an input/textarea
            const tag = document.activeElement.tagName;
            if (tag === 'INPUT' || tag === 'TEXTAREA' || tag === 'SELECT') return;

            const video = document.querySelector('video');
            if (!video) return;

            let handled = false;
            switch (e.key) {
                case ' ': // Space: play/pause
                    e.preventDefault();
                    e.stopPropagation();
                    e.stopImmediatePropagation();
                    if (video.paused) video.play(); else video.pause();
                    handled = true;
                    break;
                case 'ArrowRight': // Right: +5s (Shift=2s, Ctrl=10s)
                    e.preventDefault();
                    e.stopPropagation();
                    e.stopImmediatePropagation();
                    let stepR = 5;
                    if (e.shiftKey) stepR = 2;
                    else if (e.ctrlKey) stepR = 10;
                    video.currentTime = Math.min(video.currentTime + stepR, video.duration || 0);
                    handled = true;
                    break;
                case 'ArrowLeft': // Left: -5s (Shift=2s, Ctrl=10s)
                    e.preventDefault();
                    e.stopPropagation();
                    e.stopImmediatePropagation();
                    let stepL = 5;
                    if (e.shiftKey) stepL = 2;
                    else if (e.ctrlKey) stepL = 10;
                    video.currentTime = Math.max(video.currentTime - stepL, 0);
                    handled = true;
                    break;
                case 'ArrowUp': // Up: volume +5%
                    e.preventDefault();
                    e.stopPropagation();
                    e.stopImmediatePropagation();
                    if (video.volume < 0.95) video.volume = Math.min(video.volume + 0.05, 1);
                    else video.volume = 1;
                    handled = true;
                    break;
                case 'ArrowDown': // Down: volume -5%
                    e.preventDefault();
                    e.stopPropagation();
                    e.stopImmediatePropagation();
                    if (video.volume > 0.05) video.volume = Math.max(video.volume - 0.05, 0);
                    else video.volume = 0;
                    handled = true;
                    break;
                case 'f':
                case 'F':
                    e.preventDefault();
                    e.stopPropagation();
                    e.stopImmediatePropagation();
                    if (!document.fullscreenElement) {
                        const player = document.querySelector('.jwplayer') || document.querySelector('#fm-player-overlay');
                        if (player) player.requestFullscreen().catch(() => {});
                    } else {
                        document.exitFullscreen().catch(() => {});
                    }
                    handled = true;
                    break;
                case 'm':
                case 'M':
                    e.preventDefault();
                    e.stopPropagation();
                    e.stopImmediatePropagation();
                    video.muted = !video.muted;
                    handled = true;
                    break;
                default:
                    break;
            }

            if (handled) {
                // Cancel any popup or notification if open
                if (activePopup) closePopup(activePopup);
                if (resumeNotification) {
                    resumeNotification.style.display = 'none';
                    setTimeout(() => resumeNotification.remove(), 500);
                    resumeNotification = null;
                }
            }
        }, { capture: true });  // capture phase to override JW Player's handler
    }

    // ----- Apply poster background -----
    function applyPosterBackground() {
        const galleryImage = getGalleryImage();
        if (!galleryImage) return;
        const player = document.querySelector('.jwplayer .jw-media, .jwplayer');
        if (player) {
            player.style.backgroundImage = `url(${galleryImage})`;
            player.style.backgroundSize = 'cover';
            player.style.backgroundPosition = 'center';
        }
    }

    // ----- Show help popup -----
    function toggleHelpPopup(anchor) {
        let popup = anchor.querySelector('.fm-help-popup');
        if (popup) {
            if (popup.style.display === 'block') {
                popup.style.display = 'none';
                return;
            } else {
                popup.style.display = 'block';
                return;
            }
        }

        popup = document.createElement('div');
        popup.className = 'fm-help-popup';
        popup.innerHTML = `
            <button class="fm-close-help">✕</button>
            <h4>⌨️ Keyboard Shortcuts</h4>
            <table>
                <tr><td>Space</td><td>Play / Pause</td></tr>
                <tr><td>← / →</td><td>Seek -5s / +5s</td></tr>
                <tr><td>Shift + ← / →</td><td>Seek -2s / +2s</td></tr>
                <tr><td>Ctrl + ← / →</td><td>Seek -10s / +10s</td></tr>
                <tr><td>↑ / ↓</td><td>Volume +5% / -5%</td></tr>
                <tr><td>F</td><td>Toggle Fullscreen</td></tr>
                <tr><td>M</td><td>Mute / Unmute</td></tr>
                <tr><td>⏎ (Enter)</td><td>Enter / Exit fullscreen (alternative)</td></tr>
            </table>
            <p style="margin-top:10px;font-size:12px;color:#888;">VLC‑style shortcuts</p>
        `;
        anchor.appendChild(popup);
        popup.style.display = 'block';

        popup.querySelector('.fm-close-help').addEventListener('click', () => {
            popup.style.display = 'none';
        });

        // Close when clicking outside
        setTimeout(() => {
            document.addEventListener('click', function closeHelp(e) {
                if (!popup.contains(e.target) && e.target !== anchor) {
                    popup.style.display = 'none';
                    document.removeEventListener('click', closeHelp);
                }
            });
        }, 0);
    }

    // ----- NEW: Add back arrow button (Netflix style) -----
    function addBackArrow() {
        const player = document.querySelector('.jwplayer');
        if (!player) return;
        if (player.querySelector('.fm-back-arrow')) return; // already exists

        const arrow = document.createElement('div');
        arrow.className = 'fm-back-arrow';
        arrow.innerHTML = '‹'; // using a left arrow symbol (or use SVG)
        arrow.title = 'Go Back';
        arrow.addEventListener('click', (e) => {
            e.stopPropagation();
            history.back();
        });
        // Ensure player is relatively positioned for absolute child
        player.style.position = 'relative';
        player.appendChild(arrow);
    }

    // ----- Netflix‑style Header CSS (unchanged) -----
    function applyNetflixHeaderStyle() {
        const style = document.createElement('style');
        style.id = 'netflix-header-style';
        style.textContent = `
            /* ----- Reset header container ----- */
            .mABbDSZHPvPgjuCFbYzR {
                display: flex !important;
                align-items: center !important;
                justify-content: space-between !important;
                background: #141414 !important;
                padding: 0 20px !important;
                height: 68px !important;
                box-sizing: border-box !important;
                font-family: 'Helvetica Neue', Arial, sans-serif !important;
                position: relative !important;
                z-index: 100 !important;
                border-bottom: 1px solid #222 !important;
            }

            /* ----- Logo: moved up ----- */
            .LQziSgKbeygrZIsCBskq {
                order: 1 !important;
                flex: 0 0 auto !important;
                margin-right: 30px !important;
                display: flex !important;
                align-items: center !important;
                height: 100% !important;
                margin-top: -25px !important;
            }
            .LQziSgKbeygrZIsCBskq a {
                display: flex !important;
                align-items: center !important;
                height: 100% !important;
            }
            .LQziSgKbeygrZIsCBskq a img {
                height: 28px !important;
                width: auto !important;
                filter: brightness(1.2) !important;
                vertical-align: middle !important;
            }

            /* ----- Navigation container ----- */
            .jDEkRboIwSzZuBohNIbs {
                order: 2 !important;
                flex: 1 1 auto !important;
                display: flex !important;
                align-items: center !important;
                height: 100% !important;
            }
            .jDEkRboIwSzZuBohNIbs .GfxTXMYPqMeMZtDOVBrh {
                display: flex !important;
                align-items: center !important;
                gap: 0 !important;
                margin: 0 !important;
                padding: 0 !important;
                list-style: none !important;
                background: none !important;
                width: auto !important;
                flex-wrap: wrap !important;
                height: 100% !important;
                margin-top: 30px !important;
            }

            /* ----- Hide mobile toggles & dropdowns ----- */
            .wnoQOCXClYVInXmJwXTs,
            .zgoCvaGaHZraviafqXPT,
            .lmlkFPZBqqJQCzDMCZtC {
                display: none !important;
            }

            /* ----- Each menu item ----- */
            .zmPMjcwGapYHvwBsiziz {
                display: inline-flex !important;
                align-items: center !important;
                height: 100% !important;
                margin: 0 !important;
                padding: 0 !important;
                background: none !important;
            }
            .zmPMjcwGapYHvwBsiziz a,
            .zmPMjcwGapYHvwBsiziz .nmrPlLTKWRJbCDwSABTs {
                display: flex !important;
                align-items: center !important;
                height: 100% !important;
                padding: 0 14px !important;
                font-size: 14px !important;
                font-weight: 500 !important;
                color: #e5e5e5 !important;
                text-decoration: none !important;
                transition: color 0.3s !important;
                background: none !important;
                border: none !important;
                cursor: pointer !important;
                font-family: inherit !important;
                text-transform: none !important;
                letter-spacing: 0 !important;
                border-bottom: none !important;
                outline: none !important;
                position: relative !important;
                line-height: 1 !important;
            }
            .zmPMjcwGapYHvwBsiziz a:hover,
            .zmPMjcwGapYHvwBsiziz .nmrPlLTKWRJbCDwSABTs:hover {
                color: #fff !important;
            }

            /* ----- Remove any border from the parent active class ----- */
            .jRmmVllQBlRmkCrJscHk,
            .jRmmVllQBlRmkCrJscHk a,
            .jRmmVllQBlRmkCrJscHk .nmrPlLTKWRJbCDwSABTs {
                border-bottom: none !important;
                text-decoration: none !important;
                outline: none !important;
            }

            /* ----- Red underline using ::after (single line) ----- */
            .zmPMjcwGapYHvwBsiziz.jRmmVllQBlRmkCrJscHk a::after,
            .zmPMjcwGapYHvwBsiziz.jRmmVllQBlRmkCrJscHk .nmrPlLTKWRJbCDwSABTs::after {
                content: '' !important;
                position: absolute !important;
                bottom: 0 !important;
                left: 14px !important;
                right: 14px !important;
                height: 3px !important;
                background: #E50914 !important;
                display: block !important;
            }

            /* Hide icons inside menu items */
            .zmPMjcwGapYHvwBsiziz .sRtIYZLiBXaGfyFNalbS {
                display: none !important;
            }

            /* ----- Search bar – red border & thicker on focus ----- */
            .qTzjGrVATJzUDPUfxxjx {
                order: 3 !important;
                margin-left: auto !important;
                margin-right: 10px !important;
                display: flex !important;
                align-items: center !important;
                background: transparent !important;
                border: 1px solid #E50914 !important; /* red border */
                border-radius: 4px !important;
                padding: 4px 8px !important;
                transition: border 0.3s ease !important;
                height: 36px !important;
                box-sizing: border-box !important;
                margin-top: -25px !important;
            }
            .qTzjGrVATJzUDPUfxxjx:hover,
            .qTzjGrVATJzUDPUfxxjx:focus-within {
                border-color: #E50914 !important;
                border-width: 2px !important; /* thicker on focus */
                background: rgba(255,255,255,0.05) !important;
            }
            .qTzjGrVATJzUDPUfxxjx input {
                background: transparent !important;
                border: none !important;
                color: #fff !important;
                font-size: 14px !important;
                padding: 4px 6px !important;
                width: 150px !important;
                transition: width 0.3s !important;
                font-family: inherit !important;
                outline: none !important;
                height: 100% !important;
                box-sizing: border-box !important;
            }
            .qTzjGrVATJzUDPUfxxjx input::placeholder {
                color: #888 !important;
            }
            .qTzjGrVATJzUDPUfxxjx input:focus {
                width: 200px !important;
            }
            .qTzjGrVATJzUDPUfxxjx .akaSsprcAyYadjAhgDPS,
            .qTzjGrVATJzUDPUfxxjx .akaSsprcAyYadjAhgDPS i {
                color: #E50914 !important;
                font-size: 18px !important;
                padding: 0 4px !important;
                cursor: pointer !important;
                transition: color 0.3s !important;
                background: none !important;
                border: none !important;
                display: flex !important;
                align-items: center !important;
                justify-content: center !important;
                height: 100% !important;
            }
            .qTzjGrVATJzUDPUfxxjx .akaSsprcAyYadjAhgDPS:hover,
            .qTzjGrVATJzUDPUfxxjx .akaSsprcAyYadjAhgDPS:hover i {
                color: #fff !important;
            }

            /* ----- Hide all extra right-side elements ----- */
            .uGdlAjeTUayiUsimsDkj,
            .MPoJnzEhlVrBqPDyIovh,
            .mAYyKjsaAuiComigKmIM,
            .BzqTjbFxdurweHcayjqw,
            .lDlZuXimlNcBGCLnUGNO,
            #login_menu,
            .cjcwdpZXvnpUToOaJGrD {
                display: none !important;
            }

            /* ----- Full page black background ----- */
            html, body,
            .DCboMmuUENnKihwgOwXb,
            main,
            .RaEpeiJspPZHGspFraNT,
            .DROxDdtkqvoKQEsjmpkt,
            .CFWXVhcOrhRIPHYmNHhN,
            .HSFhsUOhbjUDORBKZDyq,
            .LqYBXXNKEVymOetgYioa,
            .SUbeoeWrQtmEIzJYsDQV,
            .gDkpdAZeiLyqDMtBXhrp,
            .BbEjHlddEWVCocIwUhrS,
            .LaJbazGelCYqLxeuFRvr,
            .lZfbKBYZlgCLZOpszUqP,
            footer,
            .DBojjLRDMYLwaXBjUtTC {
                background: #141414 !important;
                margin: 0 !important;
                padding: 0 !important;
            }

            /* Ensure text is readable on dark background */
            body, div, span, p, h1, h2, h3, h4, h5, h6, li, label {
                color: #e5e5e5 !important;
            }

            /* Responsive */
            @media (max-width: 768px) {
                .jDEkRboIwSzZuBohNIbs .GfxTXMYPqMeMZtDOVBrh {
                    flex-wrap: wrap !important;
                }
                .zmPMjcwGapYHvwBsiziz a {
                    font-size: 12px !important;
                    padding: 0 8px !important;
                }
                .qTzjGrVATJzUDPUfxxjx input {
                    width: 100px !important;
                }
                .qTzjGrVATJzUDPUfxxjx input:focus {
                    width: 140px !important;
                }
            }
        `;
        document.head.appendChild(style);
        console.log('✅ Netflix‑style header applied with red search border and full black background.');
    }

    // ----- Apply all enhancements -----
    function applyAllEnhancements() {
        const oldHeader = document.getElementById('netflix-header-style');
        if (oldHeader) oldHeader.remove();
        applyNetflixHeaderStyle();

        if (!document.getElementById('custom-subtitle-styles')) {
            injectSubtitleStyles();
        }

        if (!document.getElementById('netflix-jw-style')) {
            const styleTag = document.createElement('style');
            styleTag.id = 'netflix-jw-style';
            document.head.appendChild(styleTag);
            injectNetflixCSS();
        }

        hidePremiumIcon();

        const container = document.querySelector('.jw-controlbar .jw-button-container');
        if (!container) return false;

        if (!container.querySelector('.jw-title-display')) {
            const titleSpan = document.createElement('span');
            titleSpan.className = 'jw-title-display';
            titleSpan.textContent = getMovieTitle();
            container.prepend(titleSpan);
        }

        if (!container.querySelector('.custom-download-btn')) {
            const btn = document.createElement('div');
            btn.className = 'custom-download-btn';
            btn.title = 'Download';
            btn.appendChild(createDownloadSVG());
            btn.addEventListener('click', (e) => {
                e.stopPropagation();
                if (activePopup === 'download') {
                    closePopup('download');
                } else {
                    const content = [
                        { label: '⬇️  Download Video', action: downloadVideo, selected: false, isHeader: false },
                        { label: '📄  Download Subtitles (SRT)', action: downloadSubtitles, selected: false, isHeader: false }
                    ];
                    openPopup('download', btn, content);
                }
            });
            container.appendChild(btn);
        }

        if (!container.querySelector('.custom-aspect-btn')) {
            const btn = document.createElement('div');
            btn.className = 'custom-aspect-btn';
            btn.title = 'Aspect Ratio';
            btn.appendChild(createAspectSVG());
            btn.addEventListener('click', (e) => {
                e.stopPropagation();
                if (activePopup === 'aspect') {
                    closePopup('aspect');
                } else {
                    openAspectPopup(btn);
                }
            });
            container.appendChild(btn);
        }

        if (!container.querySelector('.custom-refocus-btn')) {
            const btn = document.createElement('div');
            btn.className = 'custom-refocus-btn';
            btn.title = 'Refocus Player';
            btn.appendChild(createRefocusSVG());
            btn.addEventListener('click', (e) => { e.stopPropagation(); refocusPlayer(); });
            container.appendChild(btn);
        }

        if (!container.querySelector('.custom-playlist-btn')) {
            const btn = document.createElement('div');
            btn.className = 'custom-playlist-btn';
            btn.title = 'Episodes';
            btn.appendChild(createPlaylistSVG());
            btn.addEventListener('click', (e) => {
                e.stopPropagation();
                if (activePopup === 'playlist') {
                    closePopup('playlist');
                } else {
                    openPlaylistPopup(btn);
                }
            });
            container.appendChild(btn);
        }

        // ----- NEW: Help button -----
        if (!container.querySelector('.custom-help-btn')) {
            const btn = document.createElement('div');
            btn.className = 'custom-help-btn';
            btn.title = 'Keyboard Shortcuts';
            btn.appendChild(createHelpSVG());
            btn.addEventListener('click', (e) => {
                e.stopPropagation();
                toggleHelpPopup(btn);
            });
            container.appendChild(btn);
        }

        // Apply poster background
        applyPosterBackground();

        // ----- NEW: Add back arrow -----
        addBackArrow();

        const wrapper = fitPlayerToViewport();
        if (wrapper) {
            setTimeout(scrollToPlayer, 150);
        }

        setTimeout(reapplyAspectRatio, 500);
        window.addEventListener('resize', fitPlayerToViewport);

        // ----- Setup progress saving and resume -----
        setupProgressSaving();
        checkAndResume();

        // Setup keyboard shortcuts (once)
        setupKeyboardShortcuts();

        return true;
    }

    // ----- Progress saving -----
    function setupProgressSaving() {
        // Save progress every 2 seconds while playing
        let saveInterval = null;
        const video = document.querySelector('video');
        if (!video) return;

        // Listen to play/pause to control interval
        video.addEventListener('play', () => {
            if (saveInterval) clearInterval(saveInterval);
            saveInterval = setInterval(() => {
                if (!video.paused && video.currentTime > 0) {
                    saveProgress(video.currentTime);
                }
            }, 2000);
        });

        video.addEventListener('pause', () => {
            if (saveInterval) {
                clearInterval(saveInterval);
                saveInterval = null;
                // Save immediately on pause
                if (video.currentTime > 0) saveProgress(video.currentTime);
            }
        });

        video.addEventListener('ended', () => {
            if (saveInterval) {
                clearInterval(saveInterval);
                saveInterval = null;
            }
            // Clear progress when video ends
            clearSavedProgress();
        });

        // Also save on page unload
        window.addEventListener('beforeunload', () => {
            if (video && !video.paused && video.currentTime > 0) {
                saveProgress(video.currentTime);
            }
        });
    }

    function checkAndResume() {
        const savedTime = getSavedProgress();
        if (savedTime && savedTime > 0) {
            // Wait for player to be ready
            const checkPlayer = setInterval(() => {
                const video = document.querySelector('video');
                if (video && video.duration) {
                    clearInterval(checkPlayer);
                    // Only show resume if saved time is less than duration - 5s (avoid end)
                    if (savedTime < video.duration - 5) {
                        showResumeNotification(savedTime);
                    } else {
                        // If near the end, clear progress
                        clearSavedProgress();
                    }
                }
            }, 500);
        }
    }

    // ----- Wait for player -----
    let enhancementsApplied = false;

    function waitForPlayerAndApply() {
        const video = document.querySelector('video');
        if (!video) {
            setTimeout(waitForPlayerAndApply, 500);
            return;
        }

        setTimeout(() => {
            const ok = applyAllEnhancements();
            if (ok) {
                enhancementsApplied = true;
            } else {
                setTimeout(waitForPlayerAndApply, 500);
            }
        }, 300);
    }

    // ----- Observe player changes -----
    function observePlayerChanges() {
        const observer = new MutationObserver(() => {
            const container = document.querySelector('.jw-controlbar .jw-button-container');
            if (container && (!container.querySelector('.custom-download-btn') || !container.querySelector('.custom-aspect-btn') || !container.querySelector('.custom-refocus-btn') || !container.querySelector('.custom-playlist-btn') || !container.querySelector('.custom-help-btn'))) {
                enhancementsApplied = false;
                waitForPlayerAndApply();
            }
            const video = document.querySelector('video');
            if (video && currentStretch) {
                setTimeout(reapplyAspectRatio, 200);
            }
            setTimeout(() => {
                fitPlayerToViewport();
                if (!initialScrollDone) {
                    scrollToPlayer();
                }
            }, 300);
            hidePremiumIcon();
        });
        observer.observe(document.body, { childList: true, subtree: true });
    }

    // ----- Start -----
    waitForPlayerAndApply();
    observePlayerChanges();
})();
