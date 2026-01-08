const CONFIG = {
    isActive: false,
    vehicleType: "car",
    parkings: [],
    priorityParkings: [],
    refreshInterval: 10000,
    alertUrl: "",
    vehicleData: {
        plate: "",
        brand: "",
        model: "",
        color: "",
    },
};

let state = {
    refreshTimer: null,
    isProcessing: false,
    currentPage: null,
    hasProcessedCurrentPage: false,
    lastPageChange: Date.now(),
    watchdogTimer: null,
    isFillingForm: false,
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

                results.push(parkingInfo);

                if (parkingInfo.available > 0) {
                    if (state.refreshTimer) {
                        clearInterval(state.refreshTimer);
                        state.refreshTimer = null;
                        Logger.info("Timer de refresco detenido - Espacio encontrado");
                    }

                    const isPriority = CONFIG.priorityParkings.includes(parkingInfo.name);
                    parkingInfo.isPriority = isPriority;

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

    static _handleAvailableParking(parkingInfo) {
        CONFIG.isActive = false;

        if (state.refreshTimer) {
            clearInterval(state.refreshTimer);
            state.refreshTimer = null;
        }

        BotController.stop();

        const priorityLabel = parkingInfo.isPriority ? " [PRIORITARIO]" : " [REVISAR MANUALMENTE]";
        Logger.info(`Espacio encontrado: ${parkingInfo.name}${priorityLabel}`);

        setTimeout(() => {
            AutoBuyer.tryToBuy(parkingInfo.name, parkingInfo.isPriority);
        }, 100);

        NotificationManager.show(parkingInfo);
        Logger.availability(parkingInfo.name, parkingInfo.available);
    }

    static start() {
        if (CONFIG.isActive && state.refreshTimer === null) {
            this.checkAvailability();

            state.refreshTimer = setInterval(() => {
                if (!CONFIG.isActive) {
                    clearInterval(state.refreshTimer);
                    state.refreshTimer = null;
                    return;
                }

                if (state.isFillingForm) {
                    Logger.info("🛡️  Reload bloqueado: Formulario en proceso");
                    return;
                }

                window.location.reload();
            }, CONFIG.refreshInterval);

            Logger.info("Monitoreo iniciado");
        }
    }
}

class AutoBuyer {
    static currentParkingIsPriority = false;

    static async tryToBuy(parkingName, isPriority) {
        try {
            this.currentParkingIsPriority = isPriority;

            if (state.refreshTimer) {
                clearInterval(state.refreshTimer);
                state.refreshTimer = null;
                Logger.info("🛡️  Timer de refresco detenido PERMANENTEMENTE");
            }
            if (state.watchdogTimer) {
                clearInterval(state.watchdogTimer);
                state.watchdogTimer = null;
                Logger.info("🛡️  Watchdog detenido PERMANENTEMENTE");
            }

            Logger.info("🚀 Iniciando compra automática");

            const buyButton = this._findBuyButton(parkingName);
            if (!buyButton) {
                Logger.error("No se encontró el botón de comprar visible");
                return;
            }

            Logger.info("👆 Haciendo clic en botón COMPRAR...");
            buyButton.click();

            setTimeout(() => {
                this._downloadPageHTML();
                this._fillFormAggressive();
            }, 2500);

        } catch (error) {
            Logger.error(`Error en compra automática: ${error.message}`);
        }
    }

    static _downloadPageHTML() {
        try {
            const html = document.documentElement.outerHTML;
            const blob = new Blob([html], { type: 'text/html' });
            const url = URL.createObjectURL(blob);
            const a = document.createElement('a');
            a.href = url;
            a.download = `parking-form-${Date.now()}.html`;
            document.body.appendChild(a);
            a.click();
            document.body.removeChild(a);
            URL.revokeObjectURL(url);
            Logger.info("HTML descargado");
        } catch (error) {
            Logger.error(`Error descargando HTML: ${error.message}`);
        }
    }

    static _findBuyButton(parkingName) {
        const tableRows = document.querySelectorAll("table tbody tr");

        for (const row of tableRows) {
            const nameElement = row.querySelector(".flex-column .text-body h4");
            if (!nameElement) continue;

            const rowParkingName = nameElement.textContent.trim();
            if (rowParkingName === parkingName) {
                const buttons = row.querySelectorAll('button');

                for (const button of buttons) {
                    const isVisible = !button.classList.contains('d-none') &&
                        button.offsetParent !== null;

                    const hasGreenStyle = button.classList.contains('btn-success') ||
                        button.classList.contains('btn-primary') ||
                        button.textContent.toLowerCase().includes('comprar') ||
                        button.textContent.toLowerCase().includes('reservar');

                    if (isVisible && hasGreenStyle) {
                        Logger.info(`Botón encontrado: ${button.textContent.trim()}`);
                        return button;
                    }
                }
            }
        }

        return null;
    }

    static _fillFormAggressive() {
        state.isFillingForm = true;
        Logger.info("🔧 LLENADO AGRESIVO INICIADO");
        Logger.info("🛡️  PROTECCIÓN ACTIVADA: Página bloqueada contra reloads");

        const inputs = document.querySelectorAll('input[type="text"], input[type="number"], input:not([type])');
        const selects = document.querySelectorAll('select');

        Logger.info(`📋 Encontrados: ${inputs.length} inputs, ${selects.length} selects`);

        if (inputs.length === 0 && selects.length === 0) {
            Logger.error("⚠️ NO SE ENCONTRARON CAMPOS EN EL FORMULARIO");
            state.isFillingForm = false;
            return;
        }

        Logger.info("━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━");
        Logger.info("📝 LLENANDO SELECTS (desplegables):");
        selects.forEach((select, index) => {
            try {
                if (select.options.length > 1) {
                    select.selectedIndex = 1;
                    const selectedText = select.options[1].text.trim();
                    Logger.info(`  ✓ Select [${index}]: "${selectedText}"`);
                    select.dispatchEvent(new Event('change', { bubbles: true }));
                    select.dispatchEvent(new Event('blur', { bubbles: true }));
                } else {
                    Logger.info(`  ⊘ Select [${index}]: solo 1 opción, skip`);
                }
            } catch (error) {
                Logger.error(`  ✗ Select [${index}]: Error - ${error.message}`);
            }
        });

        Logger.info("━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━");
        Logger.info("✍️  LLENANDO INPUTS (campos de texto):");
        inputs.forEach((input, index) => {
            try {
                const name = (input.name || input.id || input.placeholder || "").toLowerCase();
                const type = input.type || "text";

                Logger.info(`  [${index}] Campo: name="${input.name}", id="${input.id}", type="${type}"`);

                if (name.includes('placa') || name.includes('plate')) {
                    const plate = CONFIG.vehicleData.plate || "ABC123";
                    const maxLen = input.maxLength > 0 ? input.maxLength : plate.length;
                    input.value = plate.substring(0, maxLen);
                    Logger.info(`    ✓ PLACA → "${input.value}" (max: ${maxLen})`);
                } else if (type === 'number' || name.includes('modelo') || name.includes('año') || name.includes('year')) {
                    const model = CONFIG.vehicleData.model || "2020";
                    input.value = model;
                    Logger.info(`    ✓ MODELO/AÑO → "${input.value}"`);
                } else {
                    Logger.info(`    ⊘ Campo "${input.name || input.id}" ignorado (probablemente desplegable)`);
                }

                input.dispatchEvent(new Event('input', { bubbles: true }));
                input.dispatchEvent(new Event('change', { bubbles: true }));
                input.dispatchEvent(new Event('blur', { bubbles: true }));
            } catch (error) {
                Logger.error(`  ✗ Input [${index}]: Error - ${error.message}`);
            }
        });

        Logger.info("━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━");
        Logger.info("⏳ Esperando 500ms antes de buscar botón submit...");

        setTimeout(() => {
            this._submitFormAggressive();
        }, 500);
    }

    static _submitFormAggressive() {
        Logger.info("🔍 BÚSQUEDA DE BOTÓN SUBMIT");

        const allButtons = document.querySelectorAll('button, input[type="submit"], input[type="button"]');
        const allButtonsArray = Array.from(allButtons);

        Logger.info(`📊 Total de botones encontrados: ${allButtonsArray.length}`);

        if (allButtonsArray.length === 0) {
            Logger.error("❌ NO HAY NINGÚN BOTÓN EN LA PÁGINA");
            return;
        }

        Logger.info("━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━");
        Logger.info("📋 Lista completa de botones:");
        allButtonsArray.forEach((btn, i) => {
            const text = btn.textContent?.trim() || btn.value || "(sin texto)";
            const type = btn.type || "button";
            const classes = btn.className || "(sin clases)";
            Logger.info(`  [${i}] "${text}" | type="${type}" | class="${classes}"`);
        });
        Logger.info("━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━");

        let submitButton = null;

        submitButton = document.querySelector('button[type="submit"]') ||
            document.querySelector('input[type="submit"]');
        if (submitButton) {
            Logger.info(`✅ Método 1: Encontrado por type="submit"`);
        }

        if (!submitButton) {
            submitButton = document.querySelector('button.btn-success') ||
                document.querySelector('button.btn-primary');
            if (submitButton) {
                Logger.info(`✅ Método 2: Encontrado por clase Bootstrap`);
            }
        }

        if (!submitButton) {
            const keywords = ['reservar', 'confirmar', 'comprar', 'guardar', 'enviar', 'continuar', 'aceptar', 'submit'];
            for (const keyword of keywords) {
                submitButton = allButtonsArray.find(btn => {
                    const text = (btn.textContent || btn.value || "").toLowerCase();
                    return text.includes(keyword);
                });
                if (submitButton) {
                    Logger.info(`✅ Método 3: Encontrado por keyword "${keyword}"`);
                    break;
                }
            }
        }

        if (!submitButton && allButtonsArray.length === 1) {
            submitButton = allButtonsArray[0];
            Logger.info(`✅ Método 4: Solo hay 1 botón, asumo que es el submit`);
        }

        if (!submitButton && allButtonsArray.length > 0) {
            submitButton = allButtonsArray[allButtonsArray.length - 1];
            Logger.info(`⚠️ Método 5 (fallback): Usando último botón de la página`);
        }

        if (submitButton) {
            const btnText = submitButton.textContent?.trim() || submitButton.value || "(sin texto)";
            Logger.info(`━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━`);
            Logger.info(`🎯 BOTÓN SELECCIONADO: "${btnText}"`);
            Logger.info(`━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━`);

            if (this.currentParkingIsPriority) {
                Logger.info("🚀 PARQUEO PRIORITARIO → CLIC AUTOMÁTICO");
                try {
                    submitButton.click();
                    Logger.info("✅ ¡CLIC EJECUTADO!");
                    Logger.info("━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━");
                    Logger.info("🎉 ¡COMPRA AUTOMÁTICA COMPLETADA!");
                    Logger.info("━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━");
                    Logger.info("👁️  Verifica la siguiente pantalla para confirmar el pago/reserva");
                } catch (error) {
                    Logger.error(`❌ Error al hacer clic: ${error.message}`);
                }
            } else {
                Logger.info("⏸️  PARQUEO NO PRIORITARIO → SIN CLIC AUTOMÁTICO");
                Logger.info("━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━");
                Logger.info("📝 ✅ Formulario llenado correctamente");
                Logger.info("━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━");
                Logger.info("👉 Revisa los datos y haz clic en \"" + btnText + "\" si quieres este parqueo");
                Logger.info("⚠️  Si NO te interesa, simplemente cierra esta pestaña");
            }
        } else {
            Logger.error("❌❌❌ NO SE PUDO ENCONTRAR NINGÚN BOTÓN SUBMIT ❌❌❌");
            Logger.error("Esto no debería pasar. Revisa el HTML descargado.");
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
            "vehicleData",
        ]);

        if (data.isActive) {
            CONFIG.isActive = data.isActive;
            CONFIG.vehicleType = data.vehicleType || "car";
            CONFIG.parkings = data.parkings || [];
            CONFIG.refreshInterval = data.refreshInterval * 1000;
            CONFIG.alertUrl = data.alertUrl || "";
            CONFIG.vehicleData = data.vehicleData || { plate: "", brand: "", model: "", color: "" };
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
        CONFIG.priorityParkings = config.priorityParkings || [];
        CONFIG.refreshInterval = config.refreshInterval;
        CONFIG.alertUrl = config.alertUrl || "";
        CONFIG.vehicleData = config.vehicleData || { plate: "", brand: "", model: "", color: "" };

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

            if (state.isFillingForm) {
                return;
            }

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
