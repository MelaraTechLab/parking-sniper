const CONFIG = {
    isActive: false,
    vehicleType: "car",
    parkings: [],
    refreshInterval: 10000,
    alertUrl: "",
};

let state = {
    refreshTimer: null,
    isProcessing: false,
    currentPage: null,
    hasProcessedCurrentPage: false,
    lastPageChange: Date.now(),
    watchdogTimer: null,
};

class Logger {
    static toPopup(message) {
        chrome.runtime.sendMessage({
            action: "log",
            message: message,
        });
    }

    static toConsole(message) {
        console.log(`[Parking Sniper] ${message}`);
    }

    static availability(parkingName, available) {
        const message = `${parkingName}: ${available} disponibles`;
        this.toConsole(message);
        this.toPopup(message);
    }

    static info(message) {
        this.toPopup(message);
    }

    static error(message) {
        console.error(`[Parking Sniper] ${message}`);
        this.toPopup(`Error: ${message}`);
    }
}

class PageDetector {
    static isCalendarPage() {
        const breadcrumb = document.querySelector(".breadcrumb-item.active");
        if (breadcrumb && breadcrumb.textContent.includes("Calendarios")) {
            return true;
        }
        return false;
    }

    static isVehicleTypePage() {
        const breadcrumb = document.querySelector(".breadcrumb-item.active");
        if (breadcrumb && breadcrumb.textContent.includes("Tipo de vehículo")) {
            return true;
        }

        const hasMotorcycleIcon = document.querySelector(".fa-motorcycle") !== null;
        const hasCarIcon = document.querySelector(".fa-car") !== null;
        const vehicleTitle = document.querySelector(".h1.text-bold");

        if (hasMotorcycleIcon && hasCarIcon && vehicleTitle && vehicleTitle.textContent.includes("Tipo de vehículo")) {
            return true;
        }

        return false;
    }

    static isParkingListPage() {
        const breadcrumb = document.querySelector(".breadcrumb-item.active");
        if (breadcrumb && breadcrumb.textContent.includes("Oferta de parqueos")) {
            return true;
        }

        const badges = document.querySelectorAll(".badge.badge-primary");
        for (const badge of badges) {
            if (badge.textContent.includes("Disponibles:")) {
                return true;
            }
        }

        return false;
    }

    static getCurrentPage() {
        if (this.isParkingListPage()) return "parking-list";
        if (this.isVehicleTypePage()) return "vehicle-type";
        if (this.isCalendarPage()) return "calendar";
        return null;
    }
}

class NavigationController {
    static clickCalendar() {
        const calendarRows = document.querySelectorAll("table tbody tr.cursor-pointer");
        if (calendarRows.length > 0) {
            Logger.info("Navegando al calendario");
            calendarRows[0].click();

            setTimeout(() => {
                if (PageDetector.isCalendarPage()) {
                    Logger.error("Clic en calendario falló, reintentando...");
                    this.clickCalendar();
                }
            }, 3000);

            return true;
        }
        Logger.error("No se encontraron calendarios disponibles");
        return false;
    }

    static async selectVehicleType() {
        await sleep(1500);

        const vehicleType = CONFIG.vehicleType === "motorcycle" ? "Motocicleta" : "Automóvil";
        Logger.info(`Seleccionando ${vehicleType}`);

        const icon = CONFIG.vehicleType === "motorcycle"
            ? document.querySelector(".fa-motorcycle")
            : document.querySelector(".fa-car");

        if (icon) {
            const button = icon.closest("button");
            if (button) {
                button.click();
                return true;
            }
        }

        const spans = document.querySelectorAll("span");
        for (const span of spans) {
            if (span.textContent.trim() === vehicleType) {
                span.click();
                return true;
            }
        }

        Logger.error("No se encontró el botón de tipo de vehículo");
        return false;
    }
}

class ParkingMonitor {
    static async checkAvailability() {
        if (!PageDetector.isParkingListPage() || state.isProcessing) {
            return;
        }

        state.isProcessing = true;

        try {
            const tableRows = document.querySelectorAll("table tbody tr");
            const results = [];

            for (const row of tableRows) {
                const parkingInfo = this._extractParkingInfo(row);
                if (!parkingInfo) continue;

                const shouldMonitor = this._shouldMonitorParking(parkingInfo.name);
                if (!shouldMonitor) continue;

                results.push(parkingInfo);

                if (parkingInfo.available > 0) {
                    if (state.refreshTimer) {
                        clearInterval(state.refreshTimer);
                        state.refreshTimer = null;
                        Logger.info("Timer de refresco detenido - Espacio encontrado");
                    }

                    this._handleAvailableParking(parkingInfo);
                    return;
                }
            }

            if (results.length > 0) {
                console.log("[Parking Sniper] Parqueos monitoreados:");
                results.forEach(p => console.log(`  - ${p.name}: ${p.available} disponibles`));
            }

        } catch (error) {
            Logger.error(error.message);
        } finally {
            state.isProcessing = false;
        }
    }

    static _extractParkingInfo(row) {
        const nameElement = row.querySelector(".flex-column .text-body h4");
        if (!nameElement) return null;

        const badgeElement = row.querySelector(".badge.badge-primary");
        if (!badgeElement) return null;

        const name = nameElement.textContent.trim();
        const badgeText = badgeElement.textContent.trim();
        const match = badgeText.match(/Disponibles:\s*(\d+)/);

        if (!match) return null;

        return {
            name,
            available: parseInt(match[1]),
        };
    }

    static _shouldMonitorParking(parkingName) {
        if (CONFIG.parkings.length === 0) return true;

        const parkingNameUpper = parkingName.toUpperCase();
        return CONFIG.parkings.some((p) => parkingNameUpper.includes(p.toUpperCase()));
    }

    static _handleAvailableParking(parkingInfo) {
        CONFIG.isActive = false;

        if (state.refreshTimer) {
            clearInterval(state.refreshTimer);
            state.refreshTimer = null;
        }

        BotController.stop();
        NotificationManager.show(parkingInfo);
        Logger.availability(parkingInfo.name, parkingInfo.available);
    }

    static start() {
        if (CONFIG.isActive && state.refreshTimer === null) {
            this.checkAvailability();

            state.refreshTimer = setInterval(() => {
                window.location.reload();
            }, CONFIG.refreshInterval);

            Logger.info("Monitoreo iniciado");
        }
    }
}

class NotificationManager {
    static show(parkingInfo) {
        this._playSound();
        this._openAlertUrl();

        chrome.runtime.sendMessage({
            action: "notify",
            title: "¡PARQUEO DISPONIBLE!",
            message: `${parkingInfo.name}: ${parkingInfo.available} espacio(s) disponible(s)`,
        });

        setTimeout(() => {
            alert(
                `¡PARQUEO DISPONIBLE!\n\n${parkingInfo.name}\n\n${parkingInfo.available} espacio(s) disponible(s)\n\n¡Apresúrate a reservarlo!`
            );
        }, 100);
    }

    static _openAlertUrl() {
        if (CONFIG.alertUrl && CONFIG.alertUrl.trim()) {
            try {
                window.open(CONFIG.alertUrl, '_blank');
                Logger.info("URL de alerta abierta");
            } catch (error) {
                Logger.error("No se pudo abrir la URL de alerta");
            }
        }
    }

    static _playSound() {
        try {
            const audioContext = new (window.AudioContext || window.webkitAudioContext)();
            const beeps = [
                { freq: 800, start: 0, duration: 0.15 },
                { freq: 1000, start: 0.2, duration: 0.15 },
                { freq: 1200, start: 0.4, duration: 0.3 },
            ];

            beeps.forEach((beep) => {
                const oscillator = audioContext.createOscillator();
                const gainNode = audioContext.createGain();

                oscillator.connect(gainNode);
                gainNode.connect(audioContext.destination);

                oscillator.frequency.value = beep.freq;
                oscillator.type = "sine";

                gainNode.gain.setValueAtTime(0.3, audioContext.currentTime + beep.start);
                gainNode.gain.exponentialRampToValueAtTime(
                    0.01,
                    audioContext.currentTime + beep.start + beep.duration
                );

                oscillator.start(audioContext.currentTime + beep.start);
                oscillator.stop(audioContext.currentTime + beep.start + beep.duration);
            });
        } catch (error) {
            Logger.error("No se pudo reproducir el sonido");
        }
    }
}

class BotController {
    static async init() {
        await this._loadConfig();
        this._setupMessageListener();
        await sleep(1000);

        const currentPage = PageDetector.getCurrentPage();
        if (currentPage && CONFIG.isActive) {
            this._handlePageNavigation(currentPage);
            this._startWatchdog();
        }
    }

    static async _loadConfig() {
        const data = await chrome.storage.local.get([
            "isActive",
            "vehicleType",
            "parkings",
            "refreshInterval",
            "alertUrl",
        ]);

        if (data.isActive) {
            CONFIG.isActive = data.isActive;
            CONFIG.vehicleType = data.vehicleType || "car";
            CONFIG.parkings = data.parkings || [];
            CONFIG.refreshInterval = data.refreshInterval * 1000;
            CONFIG.alertUrl = data.alertUrl || "";
        }
    }

    static _setupMessageListener() {
        chrome.runtime.onMessage.addListener((message) => {
            if (message.action === "start") {
                this._start(message.config);
            } else if (message.action === "stop") {
                this._stopBot();
            }
        });
    }

    static _start(config) {
        CONFIG.isActive = true;
        CONFIG.vehicleType = config.vehicleType;
        CONFIG.parkings = config.parkings;
        CONFIG.refreshInterval = config.refreshInterval;
        CONFIG.alertUrl = config.alertUrl || "";

        state.currentPage = null;
        state.hasProcessedCurrentPage = false;
        state.lastPageChange = Date.now();

        Logger.info("Bot iniciado");
        this._startWatchdog();

        setTimeout(() => {
            const currentPage = PageDetector.getCurrentPage();
            if (currentPage) {
                this._handlePageNavigation(currentPage);
            }
        }, 500);
    }

    static _stopBot() {
        this.stop();
        Logger.info("Bot detenido");
    }

    static stop() {
        if (state.refreshTimer) {
            clearInterval(state.refreshTimer);
            state.refreshTimer = null;
        }
        if (state.watchdogTimer) {
            clearInterval(state.watchdogTimer);
            state.watchdogTimer = null;
        }
        CONFIG.isActive = false;
    }

    static _startWatchdog() {
        this._stopWatchdog();

        state.watchdogTimer = setInterval(() => {
            if (!CONFIG.isActive) return;

            const currentPage = PageDetector.getCurrentPage();
            const timeOnPage = Date.now() - state.lastPageChange;
            const maxTimeOnPage = 45000;

            if (currentPage === "parking-list") {
                return;
            }

            if (timeOnPage > maxTimeOnPage) {
                Logger.error(`Detectado trabado en página ${currentPage} por ${Math.floor(timeOnPage / 1000)}s`);
                Logger.info("Forzando recarga de página...");
                window.location.reload();
            }
        }, 15000);
    }

    static _stopWatchdog() {
        if (state.watchdogTimer) {
            clearInterval(state.watchdogTimer);
            state.watchdogTimer = null;
        }
    }

    static _handlePageNavigation(page) {
        switch (page) {
            case "parking-list":
                ParkingMonitor.start();
                break;
            case "vehicle-type":
                NavigationController.selectVehicleType();
                break;
            case "calendar":
                NavigationController.clickCalendar();
                break;
        }
    }
}

class PageObserver {
    static start() {
        const observer = new MutationObserver(() => {
            if (!CONFIG.isActive) return;

            const detectedPage = PageDetector.getCurrentPage();

            if (detectedPage && detectedPage !== state.currentPage) {
                Logger.toConsole(`Cambio de página: ${state.currentPage} → ${detectedPage}`);
                state.currentPage = detectedPage;
                state.hasProcessedCurrentPage = false;
                state.lastPageChange = Date.now();
            }

            if (detectedPage && !state.hasProcessedCurrentPage) {
                state.hasProcessedCurrentPage = true;

                setTimeout(() => {
                    BotController._handlePageNavigation(detectedPage);
                }, 1500);
            }
        });

        observer.observe(document.body, {
            childList: true,
            subtree: true,
        });
    }
}

function sleep(ms) {
    return new Promise((resolve) => setTimeout(resolve, ms));
}

BotController.init();
PageObserver.start();
