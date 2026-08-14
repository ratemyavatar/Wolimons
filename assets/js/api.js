// Wanwood API Client for Wolimons
const API_BASE = 'https://wanwoo.xyz';
const CDN_BASE = 'https://wanwoo.xyz';

// API Functions
const WanwoodAPI = {
    // Get latest limiteds from Wanwood
    async getLatestLimiteds(limit = 10) {
        try {
            const response = await fetch(`${API_BASE}/apisite/catalog/v1/items/details?itemIds=${Array.from({length: limit}, (_, i) => 1000000 + i).join(',')}`, {
                method: 'GET',
                headers: {
                    'Accept': 'application/json'
                }
            });
            if (response.ok) {
                const data = await response.json();
                return { items: data.data || [], source: 'wanwood' };
            }
        } catch (e) {
            console.log('Wanwood API error:', e);
        }
        return { items: [], source: 'wanwood' };
    },

    // Get popular items by RAP from Wanwood
    async getPopularItems(limit = 10) {
        try {
            // Try Wanwood's items endpoint
            const response = await fetch(`${API_BASE}/api/items/popular?limit=${limit}`, {
                method: 'GET',
                headers: {
                    'Accept': 'application/json'
                }
            });
            if (response.ok) {
                const data = await response.json();
                return { items: data.items || data || [], source: 'wanwood' };
            }
        } catch (e) {
            console.log('Wanwood API error:', e);
        }
        
        // Fallback: try fetching items with high RAP
        try {
            const response = await fetch(`${API_BASE}/apisite/catalog/v1/search?category=1&sort=RAP&limit=${limit}`, {
                method: 'GET',
                headers: {
                    'Accept': 'application/json'
                }
            });
            if (response.ok) {
                const data = await response.json();
                return { items: data.data || [], source: 'wanwood' };
            }
        } catch (e) {
            console.log('Wanwood search error:', e);
        }
        
        return { items: [], source: 'wanwood' };
    },

    // Get item thumbnails using Wanwood's format
    getThumbnailUrl(assetId, size = '420x420') {
        return `${CDN_BASE}/asset-thumbnail/image?assetId=${assetId}&width=${size}&height=${size}&format=png`;
    },

    // Get user avatar thumbnail
    getUserAvatarUrl(userId, size = '420x420') {
        return `${CDN_BASE}/thumbs/avatar.ashx?userId=${userId}`;
    },

    // Get item details
    async getItemDetails(itemId) {
        try {
            const response = await fetch(`${API_BASE}/apisite/catalog/v1/items/details?itemIds=${itemId}`, {
                method: 'GET',
                headers: {
                    'Accept': 'application/json'
                }
            });
            if (response.ok) {
                return await response.json();
            }
        } catch (e) {
            console.log('Wanwood API error:', e);
        }
        return null;
    },

    // Search items
    async searchItems(query) {
        try {
            const response = await fetch(`${API_BASE}/apisite/catalog/v1/search?keyword=${encodeURIComponent(query)}&limit=20`, {
                method: 'GET',
                headers: {
                    'Accept': 'application/json'
                }
            });
            if (response.ok) {
                const data = await response.json();
                return { items: data.data || [], source: 'wanwood' };
            }
        } catch (e) {
            console.log('Wanwood search error:', e);
        }
        return { items: [], source: 'wanwood' };
    },

    // Get batch thumbnails
    async getBatchThumbnails(assetIds) {
        try {
            const response = await fetch(`${API_BASE}/v1/batch`, {
                method: 'POST',
                headers: {
                    'Content-Type': 'application/json',
                    'Accept': 'application/json'
                },
                body: JSON.stringify(assetIds.map(id => ({
                    requestId: `asset-${id}`,
                    type: 'AssetThumbnail',
                    targetId: id
                })))
            });
            if (response.ok) {
                return await response.json();
            }
        } catch (e) {
            console.log('Wanwood batch thumbnails error:', e);
        }
        return { data: [] };
    }
};

// Format number with commas
function formatNumber(num) {
    if (num === null || num === undefined || num === '-') return '-';
    return num.toString().replace(/\B(?=(\d{3})+(?!\d))/g, ',');
}

// Create item card HTML
function createItemCard(item, useSliderStyle = true) {
    // Handle different API response formats
    const id = item.id || item.assetId || item.targetId;
    const name = item.name || item.displayName || item.title || 'Unknown Item';
    const rap = item.rap || item.recentAveragePrice || item.RecentAveragePrice || null;
    const value = item.value || item.valueEstimate || item.Value || null;
    const thumbnail = item.thumbnailUrl || item.thumbnail || item.imageUrl || 
                     `${CDN_BASE}/asset-thumbnail/image?assetId=${id}&width=420&height=420&format=png`;
    const isLimited = item.isLimited || item.isLimitedUnique || item.limited || false;
    const isLimitedU = item.isLimitedUnique || item.limitedUnique || false;
    
    const rapFormatted = formatNumber(rap);
    const valueFormatted = formatNumber(value);
    const valueColor = value !== null ? '#4db7d6' : '#7A8288';
    
    const limitedRibbon = isLimitedU 
        ? `<img class="limited_ribbon" src="img/limitedu.svg" alt="Limited U" width="75" height="15">` 
        : (isLimited ? `<img class="limited_ribbon" src="img/limited.svg" alt="Limited" width="56" height="15">` : '');
    
    if (useSliderStyle) {
        // Slider style card (larger)
        return `
            <div class="gen_items_slider_card">
                <a href="item?id=${id}">
                    <div class="gen_items_slider_card_container shadow">
                        <div class="gen_items_slider_main_image_container">
                            <img class="gen_items_slider_card_main_image" src="${thumbnail}" loading="lazy" data-asset-id="${id}" onerror="this.src='img/placeholder.png'">
                            ${limitedRibbon}
                        </div>
                        <div class="gen_items_slider_title_container">
                            <span class="gen_items_slider_title">${name}</span>
                        </div>
                        <div class="gen_items_slider_info_section">
                            <div class="gen_items_slider_stat_row">
                                <span class="gen_items_slider_stat_header">RAP</span>
                                <span class="gen_items_slider_stat_data">${rapFormatted}</span>
                            </div>
                            <div class="gen_items_slider_stat_row">
                                <span class="gen_items_item_value" style="color:${valueColor};">${valueFormatted}</span>
                            </div>
                        </div>
                    </div>
                </a>
            </div>
        `;
    } else {
        // Grid style card (smaller)
        const rareTag = (isLimited || isLimitedU) ? '<div class="system_item_tag_container"><div class="system_item_tag_icon rare_tag_icon" data-toggle="tooltip" title="Rare"></div></div>' : '<div class="system_item_tag_container"></div>';
        return `
            <div class="shadow_md_35 shift_up_md pb-2 search-item-card" style="background-color: #30363c;">
                <a href="item?id=${id}">
                    <div>
                        <h6 class="item_card_name px-2 text-light my-1 text-truncate">
                            <div class="text-truncate" title="${name}">${name}</div>
                        </h6>
                    </div>
                    <div class="position-relative std_item_card_img_bkgnd_gradient text-center border-top border-bottom border-dark">
                        ${rareTag}
                        <img class="d-block-inline my-1" src="${thumbnail}" height="100" width="100" alt="${name}" loading="lazy" data-asset-id="${id}" onerror="this.src='img/placeholder.png'">
                    </div>
                    <div class="px-2 pt-1">
                        <div class="d-flex justify-content-between">
                            <div><small class="text-muted">RAP</small></div>
                            <div class="text-light text-truncate ml-2">${rapFormatted}</div>
                        </div>
                        <div class="d-flex justify-content-between">
                            <div><small class="text-muted">Value</small></div>
                            <div class="text-truncate" style="color: ${valueColor};">${valueFormatted}</div>
                        </div>
                    </div>
                </a>
            </div>
        `;
    }
}

// Initialize sliders with API data
async function initSliders() {
    // Latest Limiteds
    const latestTrack = document.getElementById('latest_limiteds_track');
    if (latestTrack) {
        latestTrack.innerHTML = '<div class="text-center py-5 w-100 text-muted">Loading from Wanwood...</div>';
        const data = await WanwoodAPI.getLatestLimiteds(12);
        if (data.items && data.items.length > 0) {
            latestTrack.innerHTML = data.items.map(item => createItemCard(item, true)).join('');
        } else {
            latestTrack.innerHTML = '<div class="text-center py-5 w-100 text-muted">No items found - Wanwood may be offline</div>';
        }
    }

    // Popular Items (RAP)
    const popularTrack = document.getElementById('popular_items_track');
    if (popularTrack) {
        popularTrack.innerHTML = '<div class="text-center py-5 w-100 text-muted">Loading from Wanwood...</div>';
        const data = await WanwoodAPI.getPopularItems(12);
        if (data.items && data.items.length > 0) {
            popularTrack.innerHTML = data.items.map(item => createItemCard(item, true)).join('');
        } else {
            popularTrack.innerHTML = '<div class="text-center py-5 w-100 text-muted">No items found - Wanwood may be offline</div>';
        }
    }

    // Recently Traded
    const recentTrack = document.getElementById('recent_items_track');
    if (recentTrack) {
        recentTrack.innerHTML = '<div class="text-center py-5 w-100 text-muted">Loading from Wanwood...</div>';
        const data = await WanwoodAPI.getLatestLimiteds(12);
        if (data.items && data.items.length > 0) {
            recentTrack.innerHTML = data.items.map(item => createItemCard(item, true)).join('');
        } else {
            recentTrack.innerHTML = '<div class="text-center py-5 w-100 text-muted">No items found - Wanwood may be offline</div>';
        }
    }

    // Grid items
    const gridContainer = document.getElementById('top_rap_items_grid');
    if (gridContainer) {
        gridContainer.innerHTML = '<div class="text-center py-5 w-100 text-muted" style="grid-column: 1 / -1;">Loading from Wanwood...</div>';
        const data = await WanwoodAPI.getPopularItems(8);
        if (data.items && data.items.length > 0) {
            gridContainer.innerHTML = data.items.map(item => createItemCard(item, false)).join('');
        } else {
            gridContainer.innerHTML = '<div class="text-center py-5 w-100 text-muted" style="grid-column: 1 / -1;">No items found - Wanwood may be offline</div>';
        }
    }
}

// Slider functionality
function initSlider(sliderId, prevId, nextId) {
    const track = document.getElementById(sliderId);
    const prevBtn = document.getElementById(prevId);
    const nextBtn = document.getElementById(nextId);
    
    if (!track || !prevBtn || !nextBtn) return;
    
    const scrollAmount = 300;
    
    nextBtn.addEventListener('click', () => {
        track.scrollBy({ left: scrollAmount, behavior: 'smooth' });
    });
    
    prevBtn.addEventListener('click', () => {
        track.scrollBy({ left: -scrollAmount, behavior: 'smooth' });
    });
    
    // Update arrow visibility
    track.addEventListener('scroll', () => {
        const isAtStart = track.scrollLeft === 0;
        const isAtEnd = track.scrollLeft + track.clientWidth >= track.scrollWidth - 1;
        
        prevBtn.classList.toggle('d-none', isAtStart);
        nextBtn.classList.toggle('d-none', isAtEnd);
    });
    
    // Initial state
    if (track.scrollLeft === 0) {
        prevBtn.classList.add('d-none');
    }
}

// Initialize when DOM is ready
document.addEventListener('DOMContentLoaded', () => {
    initSliders();
    initSlider('latest_limiteds_track', 'latest_limiteds_prev', 'latest_limiteds_next');
    initSlider('popular_items_track', 'popular_items_prev', 'popular_items_next');
    initSlider('recent_items_track', 'recent_items_prev', 'recent_items_next');
});
