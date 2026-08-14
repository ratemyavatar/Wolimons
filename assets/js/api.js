// Wanwood API Client for Wolimons
const API_BASE = 'https://wanwoo.xyz';

// Sample data for demo when Wanwood is offline
const SAMPLE_ITEMS = [
    { id: 1004419, name: 'Bombastic Katana', rap: 199, value: null, thumbnail: 'https://www.pekora.zip/asset-thumbnail/image?assetId=1004419&width=420&height=420&format=png', limited: true, limitedU: true },
    { id: 1004416, name: 'Jade Katana of the Darkest Forest', rap: 190, value: null, thumbnail: 'https://www.pekora.zip/asset-thumbnail/image?assetId=1004416&width=420&height=420&format=png', limited: true, limitedU: true },
    { id: 1004413, name: 'Ocherous Katana of the Setting Sun', rap: null, value: null, thumbnail: 'https://www.pekora.zip/asset-thumbnail/image?assetId=1004413&width=420&height=420&format=png', limited: true, limitedU: true },
    { id: 1004410, name: 'Blue Katana of One Thousand Tears', rap: null, value: null, thumbnail: 'https://www.pekora.zip/asset-thumbnail/image?assetId=1004410&width=420&height=420&format=png', limited: true, limitedU: true },
    { id: 1004406, name: 'Crimson Katana of the Unsetting Sun', rap: 273, value: null, thumbnail: 'https://www.pekora.zip/asset-thumbnail/image?assetId=1004406&width=420&height=420&format=png', limited: true, limitedU: true },
    { id: 1001252, name: 'Invidia- Chief Ruler of the Realm of Blessed Roots', rap: null, value: null, thumbnail: 'https://www.pekora.zip/asset-thumbnail/image?assetId=1001252&width=420&height=420&format=png', limited: true, limitedU: true },
    { id: 1001250, name: 'White Wolf of the North', rap: null, value: null, thumbnail: 'https://www.pekora.zip/asset-thumbnail/image?assetId=1001250&width=420&height=420&format=png', limited: true, limitedU: true },
    { id: 998309, name: 'WC Ultimates: Sugilite Satisfaction', rap: 981, value: null, thumbnail: 'https://www.pekora.zip/asset-thumbnail/image?assetId=998309&width=420&height=420&format=png', limited: true, limitedU: false },
    { id: 998285, name: 'The Fire Crown', rap: null, value: null, thumbnail: 'https://www.pekora.zip/asset-thumbnail/image?assetId=998285&width=420&height=420&format=png', limited: true, limitedU: false },
    { id: 989381, name: 'Lost World Paragon', rap: 156, value: null, thumbnail: 'https://www.pekora.zip/asset-thumbnail/image?assetId=989381&width=420&height=420&format=png', limited: true, limitedU: true },
    { id: 985679, name: 'Blizzard Striker', rap: 473, value: null, thumbnail: 'https://www.pekora.zip/asset-thumbnail/image?assetId=985679&width=420&height=420&format=png', limited: true, limitedU: true },
    { id: 979481, name: 'Disgraced Baroness of the Federation', rap: 6876, value: 15000, thumbnail: 'https://www.pekora.zip/asset-thumbnail/image?assetId=979481&width=420&height=420&format=png', limited: true, limitedU: true },
    { id: 56781, name: 'Domino Crown', rap: 670, value: 800000, thumbnail: 'https://www.pekora.zip/asset-thumbnail/image?assetId=56781&width=420&height=420&format=png', limited: true, limitedU: false },
    { id: 37738, name: 'Dominus Empyreus', rap: 12050, value: 500000, thumbnail: 'https://www.pekora.zip/asset-thumbnail/image?assetId=37738&width=420&height=420&format=png', limited: true, limitedU: false },
    { id: 31413, name: 'Dominus Frigidus', rap: 6988, value: 300000, thumbnail: 'https://www.pekora.zip/asset-thumbnail/image?assetId=31413&width=420&height=420&format=png', limited: true, limitedU: false },
];

const SAMPLE_POPULAR_ITEMS = [
    { id: 16821, name: 'Rainbow Shaggy', rap: 4614, value: 170000, thumbnail: 'https://www.pekora.zip/asset-thumbnail/image?assetId=16821&width=420&height=420&format=png', limited: true, limitedU: false },
    { id: 16588, name: 'Rainbow Shaggy', rap: 3174, value: 120000, thumbnail: 'https://www.pekora.zip/asset-thumbnail/image?assetId=16588&width=420&height=420&format=png', limited: true, limitedU: false },
    { id: 45393, name: 'Red Bandana of SQL Injection', rap: 7325, value: 115000, thumbnail: 'https://www.pekora.zip/asset-thumbnail/image?assetId=45393&width=420&height=420&format=png', limited: true, limitedU: false },
    { id: 378194, name: 'Archduke of the Federation', rap: 100001, value: 115000, thumbnail: 'https://www.pekora.zip/asset-thumbnail/image?assetId=378194&width=420&height=420&format=png', limited: true, limitedU: false },
    { id: 7265, name: 'Dark Assassin', rap: 10000, value: 110000, thumbnail: 'https://www.pekora.zip/asset-thumbnail/image?assetId=7265&width=420&height=420&format=png', limited: true, limitedU: false },
    { id: 44745, name: 'Red Sparkle Time Fedora', rap: 26800, value: 62500, thumbnail: 'https://www.pekora.zip/asset-thumbnail/image?assetId=44745&width=420&height=420&format=png', limited: true, limitedU: false },
    { id: 41910, name: 'Midnight Blue Sparkle Time Fedora', rap: 20897, value: 62500, thumbnail: 'https://www.pekora.zip/asset-thumbnail/image?assetId=41910&width=420&height=420&format=png', limited: true, limitedU: false },
    { id: 911749, name: 'Bharama Guardian', rap: 20000, value: 60000, thumbnail: 'https://www.pekora.zip/asset-thumbnail/image?assetId=911749&width=420&height=420&format=png', limited: true, limitedU: false },
];

// API Functions
const WanwoodAPI = {
    // Get latest limiteds
    async getLatestLimiteds(limit = 10) {
        try {
            // Try Wanwood API first
            const response = await fetch(`${API_BASE}/api/items/latest?limit=${limit}`);
            if (response.ok) {
                return await response.json();
            }
        } catch (e) {
            console.log('Wanwood API offline, using sample data');
        }
        // Fallback to sample data
        return { items: SAMPLE_ITEMS.slice(0, limit), source: 'demo' };
    },

    // Get popular items by RAP
    async getPopularItems(limit = 10) {
        try {
            const response = await fetch(`${API_BASE}/api/items/popular?limit=${limit}`);
            if (response.ok) {
                return await response.json();
            }
        } catch (e) {
            console.log('Wanwood API offline, using sample data');
        }
        return { items: SAMPLE_POPULAR_ITEMS.slice(0, limit), source: 'demo' };
    },

    // Get item thumbnails using Wanwood's format
    getThumbnailUrl(assetId, size = '420x420') {
        return `${API_BASE}/asset-thumbnail/image?assetId=${assetId}&width=${size}&height=${size}&format=png`;
    },

    // Get item details
    async getItemDetails(itemId) {
        try {
            const response = await fetch(`${API_BASE}/apisite/catalog/v1/items/details?itemIds=${itemId}`);
            if (response.ok) {
                return await response.json();
            }
        } catch (e) {
            console.log('Wanwood API offline');
        }
        // Return sample data for demo
        const item = [...SAMPLE_ITEMS, ...SAMPLE_POPULAR_ITEMS].find(i => i.id === parseInt(itemId));
        return item ? { data: [item] } : null;
    },

    // Search items
    async searchItems(query) {
        try {
            const response = await fetch(`${API_BASE}/api/items/search?q=${encodeURIComponent(query)}`);
            if (response.ok) {
                return await response.json();
            }
        } catch (e) {
            console.log('Wanwood API offline');
        }
        // Filter sample data for demo
        const q = query.toLowerCase();
        const results = [...SAMPLE_ITEMS, ...SAMPLE_POPULAR_ITEMS].filter(i => 
            i.name.toLowerCase().includes(q)
        );
        return { items: results, source: 'demo' };
    },

    // Get user avatar thumbnail
    getUserAvatarUrl(userId, size = '420x420') {
        return `${API_BASE}/thumbs/avatar.ashx?userId=${userId}`;
    }
};

// Format number with commas
function formatNumber(num) {
    if (num === null || num === undefined || num === '-') return '-';
    return num.toString().replace(/\B(?=(\d{3})+(?!\d))/g, ',');
}

// Create item card HTML
function createItemCard(item, useSliderStyle = true) {
    const rap = item.rap || '-';
    const value = item.value || '-';
    const rapFormatted = formatNumber(rap);
    const valueFormatted = formatNumber(value);
    const valueColor = value !== '-' ? '#4db7d6' : '#7A8288';
    const limitedRibbon = item.limitedU 
        ? '<img class="limited_ribbon" src="img/limitedu.svg" alt="Limited U" width="75" height="15">' 
        : (item.limited ? '<img class="limited_ribbon" src="img/limited.svg" alt="Limited" width="56" height="15">' : '');
    
    if (useSliderStyle) {
        // Slider style card (larger)
        return `
            <div class="gen_items_slider_card">
                <a href="item?id=${item.id}">
                    <div class="gen_items_slider_card_container shadow">
                        <div class="gen_items_slider_main_image_container">
                            <img class="gen_items_slider_card_main_image" src="${item.thumbnail}" loading="lazy" data-asset-id="${item.id}" onerror="this.src='img/placeholder.png'">
                            ${limitedRibbon}
                        </div>
                        <div class="gen_items_slider_title_container">
                            <span class="gen_items_slider_title">${item.name}</span>
                        </div>
                        <div class="gen_items_slider_info_section">
                            <div class="gen_items_slider_stat_row">
                                <span class="gen_items_slider_stat_header">RAP</span>
                                <span class="gen_items_slider_stat_data">${rapFormatted}</span>
                            </div>
                            <div class="gen_items_slider_stat_row">
                                <span class="gen_items_slider_stat_header">Value</span>
                                <span class="gen_items_slider_stat_data" style="color:${valueColor};">${valueFormatted}</span>
                            </div>
                        </div>
                    </div>
                </a>
            </div>
        `;
    } else {
        // Grid style card (smaller)
        const rareTag = item.limited ? '<div class="system_item_tag_container"><div class="system_item_tag_icon rare_tag_icon" data-toggle="tooltip" title="Rare"></div></div>' : '<div class="system_item_tag_container"></div>';
        return `
            <div class="shadow_md_35 shift_up_md pb-2 search-item-card" style="background-color: #30363c;">
                <a href="item?id=${item.id}">
                    <div>
                        <h6 class="item_card_name px-2 text-light my-1 text-truncate">
                            <div class="text-truncate" title="${item.name}">${item.name}</div>
                        </h6>
                    </div>
                    <div class="position-relative std_item_card_img_bkgnd_gradient text-center border-top border-bottom border-dark">
                        ${rareTag}
                        <img class="d-block-inline my-1" src="${item.thumbnail}" height="100" width="100" alt="Item Thumbnail" loading="lazy" data-asset-id="${item.id}" onerror="this.src='img/placeholder.png'">
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
        const data = await WanwoodAPI.getLatestLimiteds(12);
        if (data.items && data.items.length > 0) {
            latestTrack.innerHTML = data.items.map(item => createItemCard(item, true)).join('');
        }
    }

    // Popular Items (RAP)
    const popularTrack = document.getElementById('popular_items_track');
    if (popularTrack) {
        const data = await WanwoodAPI.getPopularItems(12);
        if (data.items && data.items.length > 0) {
            popularTrack.innerHTML = data.items.map(item => createItemCard(item, true)).join('');
        }
    }

    // Recently Traded
    const recentTrack = document.getElementById('recent_items_track');
    if (recentTrack) {
        const data = await WanwoodAPI.getLatestLimiteds(12);
        if (data.items && data.items.length > 0) {
            recentTrack.innerHTML = data.items.map(item => createItemCard(item, true)).join('');
        }
    }

    // Grid items
    const gridContainer = document.getElementById('top_rap_items_grid');
    if (gridContainer) {
        const data = await WanwoodAPI.getPopularItems(8);
        if (data.items && data.items.length > 0) {
            gridContainer.innerHTML = data.items.map(item => createItemCard(item, false)).join('');
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
