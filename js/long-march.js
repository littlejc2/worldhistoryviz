// 长征路线动画：按日期在路线节点之间插值，逐帧绘制行军轨迹

const DAY_MS = 24 * 60 * 60 * 1000;

const TYPE_STYLES = {
    start:    { color: '#d7261e', label: '出发' },
    end:      { color: '#d7261e', label: '胜利' },
    meeting:  { color: '#b8860b', label: '会议' },
    battle:   { color: '#8b1a1a', label: '战役' },
    river:    { color: '#1f6fb2', label: '渡江' },
    mountain: { color: '#4a6b3a', label: '雪山草地' }
};

function toDay(dateStr) {
    return Date.parse(dateStr + 'T00:00:00Z') / DAY_MS;
}

function formatDate(day) {
    const d = new Date(Math.floor(day) * DAY_MS);
    return `${d.getUTCFullYear()}年${d.getUTCMonth() + 1}月${d.getUTCDate()}日`;
}

class LongMarchAnimation {
    constructor(data) {
        this.data = data;
        this.routes = data.routes.map(route => ({
            ...route,
            waypoints: route.waypoints
                .map(wp => ({ ...wp, day: toDay(wp.date) }))
                .sort((a, b) => a.day - b.day)
        }));
        this.startDay = Math.min(...this.routes.map(r => r.waypoints[0].day));
        this.endDay = Math.max(...this.routes.map(r => r.waypoints[r.waypoints.length - 1].day));
        this.currentDay = this.startDay;
        this.playing = false;
        this.daysPerSecond = 12;
        this.follow = true;
        this.lastFrame = null;
        this.lastPan = 0;

        this.dom = {
            play: document.getElementById('lm-play'),
            restart: document.getElementById('lm-restart'),
            speed: document.getElementById('lm-speed'),
            follow: document.getElementById('lm-follow'),
            slider: document.getElementById('lm-slider'),
            date: document.getElementById('lm-date'),
            dayCount: document.getElementById('lm-daycount'),
            card: document.getElementById('lm-card'),
            log: document.getElementById('lm-log')
        };

        this.initMap();
        this.initLayers();
        this.bindControls();
        this.render();
    }

    initMap() {
        this.map = L.map('map', { zoomControl: false, attributionControl: true });
        L.control.zoom({ position: 'topright' }).addTo(this.map);
        L.tileLayer('https://{s}.tile.openstreetmap.org/{z}/{x}/{y}.png', {
            maxZoom: 12,
            attribution: '&copy; OpenStreetMap contributors'
        }).addTo(this.map);

        const all = this.routes.flatMap(r => r.waypoints.map(wp => [wp.lat, wp.lng]));
        this.fullBounds = L.latLngBounds(all).pad(0.1);
        this.fitAll(false);
    }

    // 给左侧面板和底部控制条留出空间
    fitAll(fly) {
        const mobile = window.innerWidth <= 720;
        const options = {
            paddingTopLeft: mobile ? [10, 150] : [260, 20],
            paddingBottomRight: mobile ? [10, 160] : [20, 110]
        };
        fly ? this.map.flyToBounds(this.fullBounds, { ...options, duration: 2 })
            : this.map.fitBounds(this.fullBounds, options);
    }

    initLayers() {
        this.routes.forEach(route => {
            // 完整路线的淡色底线，提示全程走向
            route.ghost = L.polyline(route.waypoints.map(wp => [wp.lat, wp.lng]), {
                color: route.color, weight: 2, opacity: 0.25, dashArray: '4 6'
            }).addTo(this.map);

            route.trail = L.polyline([], {
                color: route.color, weight: 4, opacity: 0.9, lineJoin: 'round'
            }).addTo(this.map);

            route.head = L.marker([route.waypoints[0].lat, route.waypoints[0].lng], {
                icon: L.divIcon({ className: 'lm-head', html: '<span>★</span>', iconSize: [28, 28] }),
                zIndexOffset: 1000
            }).addTo(this.map);

            route.waypoints.forEach(wp => {
                const style = TYPE_STYLES[wp.type] || TYPE_STYLES.meeting;
                wp.marker = L.circleMarker([wp.lat, wp.lng], {
                    radius: wp.type === 'start' || wp.type === 'end' ? 8 : 6,
                    color: '#fff', weight: 2, fillColor: style.color, fillOpacity: 1
                }).bindPopup(this.popupHtml(wp))
                  .bindTooltip(wp.name, { direction: 'right', offset: [8, 0], className: 'lm-label' });
                wp.reached = false;
            });
        });
    }

    popupHtml(wp) {
        const style = TYPE_STYLES[wp.type] || TYPE_STYLES.meeting;
        return `<div class="lm-popup">
            <div class="lm-tag" style="background:${style.color}">${style.label}</div>
            <h3>${wp.title}</h3>
            <div class="lm-meta">${wp.date} · ${wp.name}</div>
            <p>${wp.desc}</p>
        </div>`;
    }

    bindControls() {
        const { play, restart, speed, follow, slider } = this.dom;
        slider.min = 0;
        slider.max = this.endDay - this.startDay;
        slider.step = 0.1;

        play.addEventListener('click', () => this.toggle());
        restart.addEventListener('click', () => { this.seek(this.startDay); this.play(); });
        speed.addEventListener('change', () => { this.daysPerSecond = Number(speed.value); });
        follow.addEventListener('change', () => {
            this.follow = follow.checked;
            if (!this.follow) this.fitAll(true);
        });
        slider.addEventListener('input', () => {
            this.pause();
            this.seek(this.startDay + Number(slider.value));
        });
        document.addEventListener('keydown', e => {
            if (e.code === 'Space' && e.target === document.body) {
                e.preventDefault();
                this.toggle();
            }
        });
    }

    toggle() {
        this.playing ? this.pause() : this.play();
    }

    play() {
        if (this.currentDay >= this.endDay) this.seek(this.startDay);
        this.playing = true;
        this.dom.play.textContent = '暂停';
        this.lastFrame = null;
        requestAnimationFrame(ts => this.tick(ts));
    }

    pause() {
        this.playing = false;
        this.dom.play.textContent = '播放';
    }

    tick(ts) {
        if (!this.playing) return;
        if (this.lastFrame !== null) {
            const dt = (ts - this.lastFrame) / 1000;
            this.currentDay = Math.min(this.endDay, this.currentDay + dt * this.daysPerSecond);
        }
        this.lastFrame = ts;
        this.render();
        if (this.currentDay >= this.endDay) {
            this.pause();
            if (this.follow) this.fitAll(true);
            return;
        }
        requestAnimationFrame(t => this.tick(t));
    }

    // 拖动进度条时重置已到达状态，再按新日期重绘
    seek(day) {
        this.currentDay = day;
        this.dom.log.innerHTML = '';
        this.routes.forEach(route => route.waypoints.forEach(wp => {
            wp.reached = false;
            wp.marker.remove();
        }));
        this.render(true);
    }

    positionAt(route, day) {
        const wps = route.waypoints;
        if (day <= wps[0].day) return { index: 0, latlng: [wps[0].lat, wps[0].lng] };
        for (let i = 0; i < wps.length - 1; i++) {
            const a = wps[i], b = wps[i + 1];
            if (day < b.day) {
                const t = (day - a.day) / (b.day - a.day);
                return {
                    index: i,
                    latlng: [a.lat + (b.lat - a.lat) * t, a.lng + (b.lng - a.lng) * t]
                };
            }
        }
        const last = wps[wps.length - 1];
        return { index: wps.length - 1, latlng: [last.lat, last.lng] };
    }

    render(silent = false) {
        let latestReached = null;

        this.routes.forEach(route => {
            const { index, latlng } = this.positionAt(route, this.currentDay);
            const passed = route.waypoints.slice(0, index + 1).map(wp => [wp.lat, wp.lng]);
            route.trail.setLatLngs([...passed, latlng]);
            route.head.setLatLng(latlng);

            route.waypoints.forEach(wp => {
                if (!wp.reached && wp.day <= this.currentDay) {
                    wp.reached = true;
                    wp.marker.addTo(this.map);
                    this.addLog(wp, route);
                    latestReached = wp;
                }
            });

            if (this.follow && this.playing) {
                const now = performance.now();
                if (now - this.lastPan > 400) {
                    this.lastPan = now;
                    this.map.panTo(latlng, { animate: true, duration: 0.4 });
                }
            }
        });

        if (latestReached && !silent) this.showCard(latestReached);
        if (silent) this.showCard(this.lastReached());

        this.dom.date.textContent = formatDate(this.currentDay);
        this.dom.dayCount.textContent = `第 ${Math.floor(this.currentDay - this.startDay) + 1} 天`;
        this.dom.slider.value = this.currentDay - this.startDay;
    }

    lastReached() {
        const reached = this.routes.flatMap(r => r.waypoints.filter(wp => wp.reached));
        return reached.sort((a, b) => b.day - a.day)[0] || null;
    }

    showCard(wp) {
        const card = this.dom.card;
        if (!wp) {
            card.classList.add('hidden');
            return;
        }
        card.innerHTML = this.popupHtml(wp);
        card.classList.remove('hidden');
        card.classList.remove('lm-flash');
        void card.offsetWidth;
        card.classList.add('lm-flash');
    }

    addLog(wp, route) {
        const style = TYPE_STYLES[wp.type] || TYPE_STYLES.meeting;
        const item = document.createElement('li');
        item.innerHTML = `<span class="lm-dot" style="background:${style.color}"></span>
            <span class="lm-log-date">${wp.date.slice(0, 7).replace('-', '.')}</span>
            <span>${wp.title}</span>`;
        item.addEventListener('click', () => {
            this.map.flyTo([wp.lat, wp.lng], 8, { duration: 1 });
            wp.marker.openPopup();
        });
        this.dom.log.prepend(item);
    }
}

async function main() {
    const res = await fetch('data/long-march.json');
    const data = await res.json();
    document.getElementById('lm-title').textContent = data.title;
    document.getElementById('lm-subtitle').textContent = data.subtitle;
    document.getElementById('lm-note').textContent = data.note;
    window.longMarch = new LongMarchAnimation(data);
}

main().catch(err => {
    console.error('长征数据加载失败', err);
    document.getElementById('lm-subtitle').textContent = '数据加载失败，请刷新重试';
});
