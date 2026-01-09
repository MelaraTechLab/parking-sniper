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
        const vehicleType = CONFIG.vehicleType === "motorcycle" ? "Motocicleta" : "Automóvil";
        Logger.info(`Esperando botones de tipo de vehículo...`);

        // MutationObserver para esperar que carguen los botones
        const startTime = Date.now();
        return new Promise((resolve) => {
            const timeout = setTimeout(() => {
                observer.disconnect();
                Logger.error("⚠️ Timeout esperando botones de vehículo, intentando de todas formas...");
                this._clickVehicleButton(vehicleType, resolve);
            }, 3000);

            const observer = new MutationObserver(() => {
                const iconMotorcycle = document.querySelector(".fa-motorcycle");
                const iconCar = document.querySelector(".fa-car");

                if (iconMotorcycle && iconCar) {
                    observer.disconnect();
                    clearTimeout(timeout);
                    const loadTime = Date.now() - startTime;
                    Logger.info(`✅ Botones cargados en ${loadTime}ms`);
                    this._clickVehicleButton(vehicleType, resolve);
                }
            });

            observer.observe(document.body, {
                childList: true,
                subtree: true
            });

            // Verificar si ya existen
            const alreadyLoaded = document.querySelector(".fa-motorcycle") && document.querySelector(".fa-car");
            if (alreadyLoaded) {
                observer.disconnect();
                clearTimeout(timeout);
                Logger.info(`✅ Botones ya estaban cargados`);
                this._clickVehicleButton(vehicleType, resolve);
            }
        });
    }

    static _clickVehicleButton(vehicleType, resolve) {
        Logger.info(`Seleccionando ${vehicleType}`);

        const icon = CONFIG.vehicleType === "motorcycle"
            ? document.querySelector(".fa-motorcycle")
            : document.querySelector(".fa-car");

        if (icon) {
            const button = icon.closest("button");
            if (button) {
                button.click();
                resolve(true);
                return;
            }
        }

        const spans = document.querySelectorAll("span");
        for (const span of spans) {
            if (span.textContent.trim() === vehicleType) {
                span.click();
                resolve(true);
                return;
            }
        }

        Logger.error("No se encontró el botón de tipo de vehículo");
        resolve(false);
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
            Logger.info("⏳ Esperando que cargue la tabla de parqueos...");
            const startTime = Date.now();

            // MutationObserver para esperar que carguen los badges de disponibilidad
            const observer = new MutationObserver(() => {
                const badges = document.querySelectorAll(".badge.badge-primary");
                let hasParkingBadges = false;

                for (const badge of badges) {
                    if (badge.textContent.includes("Disponibles:")) {
                        hasParkingBadges = true;
                        break;
                    }
                }

                if (hasParkingBadges) {
                    observer.disconnect();
                    const loadTime = Date.now() - startTime;
                    Logger.info(`✅ Tabla cargada en ${loadTime}ms`);

                    // Primera revisión inmediata
                    this.checkAvailability();

                    // Setup del timer de refresco
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
            });

            observer.observe(document.body, {
                childList: true,
                subtree: true
            });

            // Verificar si ya está cargado
            const badges = document.querySelectorAll(".badge.badge-primary");
            let alreadyLoaded = false;
            for (const badge of badges) {
                if (badge.textContent.includes("Disponibles:")) {
                    alreadyLoaded = true;
                    break;
                }
            }

            if (alreadyLoaded) {
                observer.disconnect();
                Logger.info(`✅ Tabla ya estaba cargada`);

                // Primera revisión inmediata
                this.checkAvailability();

                // Setup del timer de refresco
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

            // Espera inteligente: detectar cuando el formulario esté listo
            this._waitForFormToLoad().then(() => {
                this._fillFormAggressive();
            });

        } catch (error) {
            Logger.error(`Error en compra automática: ${error.message}`);
        }
    }

    static async _waitForFormToLoad() {
        Logger.info("⏳ Esperando a que cargue el formulario...");
        const startTime = Date.now();

        return new Promise((resolve) => {
            // Timeout de seguridad (5 segundos máximo)
            const timeout = setTimeout(() => {
                observer.disconnect();
                Logger.error("⚠️ Timeout esperando formulario, continuando de todas formas...");
                resolve();
            }, 5000);

            // MutationObserver - detecta cambios en el DOM instantáneamente
            const observer = new MutationObserver(() => {
                const formLoaded = document.getElementById('marca') ||
                                 document.getElementById('modelo');

                if (formLoaded) {
                    observer.disconnect();
                    clearTimeout(timeout);
                    const loadTime = Date.now() - startTime;
                    Logger.info(`✅ Formulario cargado en ${loadTime}ms`);
                    // Pequeña espera para que Angular termine de renderizar
                    setTimeout(() => resolve(), 200);
                }
            });

            // Iniciar observación de cambios en el DOM
            observer.observe(document.body, {
                childList: true,
                subtree: true
            });

            // Verificar si ya existe (por si cargó antes de que empezáramos a observar)
            const formAlreadyLoaded = document.getElementById('marca') || document.getElementById('modelo');
            if (formAlreadyLoaded) {
                observer.disconnect();
                clearTimeout(timeout);
                Logger.info(`✅ Formulario ya estaba cargado`);
                setTimeout(() => resolve(), 200);
            }
        });
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

    static async _fillFormAggressive() {
        state.isFillingForm = true;
        Logger.info("🔧 LLENADO ESPECÍFICO INICIADO");
        Logger.info("🛡️  PROTECCIÓN ACTIVADA: Página bloqueada contra reloads");
        Logger.info("━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━");

        try {
            // 1. Radio button tipo de vehículo (automóvil)
            const radioAutomovil = document.getElementById('datosVehiculoForm_automovil');
            if (radioAutomovil) {
                radioAutomovil.checked = true;
                radioAutomovil.dispatchEvent(new Event('change', { bubbles: true }));
                radioAutomovil.dispatchEvent(new Event('click', { bubbles: true }));
                Logger.info("✅ Tipo vehículo: Automóvil");
            } else {
                Logger.error("❌ No se encontró radio button automóvil");
            }

            // 2. Select Marca (dispara carga de colores en background)
            const selectMarca = document.getElementById('marca');
            if (selectMarca && selectMarca.options.length > 0) {
                selectMarca.selectedIndex = 0;
                const marcaText = selectMarca.options[0].text.trim();
                Logger.info(`✅ Marca: ${marcaText} (cargando colores...)`);
                selectMarca.dispatchEvent(new Event('change', { bubbles: true }));
                selectMarca.dispatchEvent(new Event('blur', { bubbles: true }));
            } else {
                Logger.error("❌ No se encontró select de marca");
            }

            // 3. Placa Letra (mientras los colores se cargan)
            const selectPlacaLetra = document.getElementById('placa_letra');
            if (selectPlacaLetra && selectPlacaLetra.options.length > 0) {
                selectPlacaLetra.selectedIndex = 0;
                const letraText = selectPlacaLetra.options[0].text.trim();
                Logger.info(`✅ Placa letra: ${letraText}`);
                selectPlacaLetra.dispatchEvent(new Event('change', { bubbles: true }));
                selectPlacaLetra.dispatchEvent(new Event('blur', { bubbles: true }));
            } else {
                Logger.error("❌ No se encontró select de placa letra");
            }

            // 4. Placa Número (todo excepto la primera letra)
            const inputPlacaNumero = document.getElementById('placa_numero');
            if (inputPlacaNumero) {
                const placa = CONFIG.vehicleData.plate || "P000000";
                // Quitar solo la primera letra, dejar todo lo demás (números Y letras)
                const placaNumero = placa.substring(1); // Ej: "P674FZV" → "674FZV"
                inputPlacaNumero.value = placaNumero;
                Logger.info(`✅ Placa número: ${placaNumero}`);
                inputPlacaNumero.dispatchEvent(new Event('input', { bubbles: true }));
                inputPlacaNumero.dispatchEvent(new Event('change', { bubbles: true }));
                inputPlacaNumero.dispatchEvent(new Event('blur', { bubbles: true }));
            } else {
                Logger.error("❌ No se encontró input de placa número");
            }

            // 5. Modelo
            const inputModelo = document.getElementById('modelo');
            if (inputModelo) {
                const modelo = CONFIG.vehicleData.model || "2020";
                inputModelo.value = modelo;
                Logger.info(`✅ Modelo: ${modelo}`);
                inputModelo.dispatchEvent(new Event('input', { bubbles: true }));
                inputModelo.dispatchEvent(new Event('change', { bubbles: true }));
                inputModelo.dispatchEvent(new Event('blur', { bubbles: true }));
            } else {
                Logger.error("❌ No se encontró input de modelo");
            }

            // 6. Select Color (esperar inteligentemente a que se carguen)
            Logger.info("⏳ Esperando a que se carguen los colores...");
            const colorResult = await this._waitForColorOptions();
            if (colorResult.success) {
                Logger.info(`✅ Color: ${colorResult.color}`);
            } else {
                Logger.error(`⚠️ Color: ${colorResult.error}`);
            }

        } catch (error) {
            Logger.error(`❌ Error llenando formulario: ${error.message}`);
        }

        Logger.info("━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━");

        // Sin espera innecesaria - clic inmediato en el botón
        this._submitFormAggressive();
    }

    static async _waitForColorOptions() {
        const maxAttempts = 15; // 1.5 segundos máximo (15 × 100ms)
        let attempts = 0;

        return new Promise(async (resolve) => {
            const checkColors = setInterval(async () => {
                const selectColor = document.getElementById('color');
                attempts++;

                if (selectColor && selectColor.options.length > 1) {
                    // Colores cargados, seleccionar la primera opción real
                    selectColor.selectedIndex = 1;
                    const colorText = selectColor.options[1].text.trim();
                    selectColor.dispatchEvent(new Event('change', { bubbles: true }));
                    selectColor.dispatchEvent(new Event('blur', { bubbles: true }));
                    clearInterval(checkColors);
                    resolve({ success: true, color: colorText });
                } else if (attempts >= maxAttempts) {
                    // Timeout: usar "OTRO COLOR" si está disponible
                    if (selectColor && selectColor.options.length === 1) {
                        selectColor.selectedIndex = 0;
                        const colorText = selectColor.options[0].text.trim();
                        selectColor.dispatchEvent(new Event('change', { bubbles: true }));
                        selectColor.dispatchEvent(new Event('blur', { bubbles: true }));
                        clearInterval(checkColors);

                        // Esperar a ver si aparece un campo de texto para "OTRO"
                        Logger.info("🔍 Buscando campo adicional para 'OTRO COLOR'...");
                        await new Promise(r => setTimeout(r, 300));

                        const otroColorInput = await AutoBuyer._findOtroColorInput();
                        if (otroColorInput) {
                            otroColorInput.value = "Azul";
                            otroColorInput.dispatchEvent(new Event('input', { bubbles: true }));
                            otroColorInput.dispatchEvent(new Event('change', { bubbles: true }));
                            Logger.info(`✅ Campo OTRO llenado con: Azul`);
                            resolve({ success: true, color: `${colorText} + campo "Azul"` });
                        } else {
                            resolve({ success: true, color: `${colorText} (sin campo adicional)` });
                        }
                    } else {
                        clearInterval(checkColors);
                        resolve({ success: false, error: "No se encontraron opciones de color" });
                    }
                }
            }, 100);
        });
    }

    static async _findOtroColorInput() {
        // Buscar input de texto NUEVO que haya aparecido (excluir campos conocidos)
        const maxAttempts = 5; // 500ms máximo
        let attempts = 0;

        // Campos conocidos del formulario que debemos ignorar
        const camposConocidos = ['placa_numero', 'modelo', 'marca', 'color', 'placa_letra'];

        return new Promise((resolve) => {
            const checkInput = setInterval(() => {
                attempts++;

                // Buscar inputs de texto visibles
                const inputs = document.querySelectorAll('input[type="text"]');
                for (const input of inputs) {
                    const id = input.id || '';
                    const name = input.name || '';
                    const lowerName = (id + ' ' + name).toLowerCase();

                    // Excluir campos conocidos del formulario original
                    if (camposConocidos.some(campo => id === campo || name === campo)) {
                        continue; // Saltar campos conocidos
                    }

                    // Si el input está visible y tiene nombre relacionado a "otro" o "color"
                    if (input.offsetParent !== null &&
                        (lowerName.includes('otro') || lowerName.includes('color') || lowerName.includes('other'))) {
                        clearInterval(checkInput);
                        Logger.info(`✅ Campo OTRO encontrado: ${id || name}`);
                        resolve(input);
                        return;
                    }
                }

                if (attempts >= maxAttempts) {
                    clearInterval(checkInput);
                    Logger.info("⊘ No se encontró campo adicional para OTRO");
                    resolve(null);
                }
            }, 100);
        });
    }

    static _submitFormAggressive() {
        Logger.info("🔍 BÚSQUEDA DE BOTÓN SUBMIT");

        // Buscar el botón en orden de especificidad (más específico primero)
        let submitButton = null;

        // 1. Más específico: por form ID y type
        submitButton = document.querySelector('button[type="submit"][form="datosVehiculoForm"]');
        if (submitButton) {
            Logger.info("✅ Método 1: Botón encontrado por form + type");
        }

        // 2. Por clase Bootstrap común
        if (!submitButton) {
            submitButton = document.querySelector('button.btn-primary');
            if (submitButton) {
                Logger.info("✅ Método 2: Botón encontrado por clase btn-primary");
            }
        }

        // 3. Por texto "guardar"
        if (!submitButton) {
            submitButton = Array.from(document.querySelectorAll('button')).find(btn =>
                btn.textContent.toLowerCase().includes('guardar')
            );
            if (submitButton) {
                Logger.info("✅ Método 3: Botón encontrado por texto 'guardar'");
            }
        }

        if (submitButton) {
            const btnText = submitButton.textContent?.trim() || "(sin texto)";
            Logger.info(`✅ Botón encontrado: "${btnText}"`);
            Logger.info("━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━");

            if (this.currentParkingIsPriority) {
                Logger.info("🚀 PARQUEO PRIORITARIO → CLIC AUTOMÁTICO");
                try {
                    submitButton.click();
                    Logger.info("✅ ¡CLIC EJECUTADO!");
                    Logger.info("━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━");
                    Logger.info("🎉 ¡COMPRA AUTOMÁTICA COMPLETADA!");
                    Logger.info("━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━");
                    Logger.info("👁️  Verifica la siguiente pantalla para confirmar");

                    // Liberar flag después de clic exitoso
                    setTimeout(() => {
                        state.isFillingForm = false;
                    }, 1000);
                } catch (error) {
                    Logger.error(`❌ Error al hacer clic: ${error.message}`);
                    state.isFillingForm = false;
                }
            } else {
                Logger.info("⏸️  PARQUEO NO PRIORITARIO → SIN CLIC AUTOMÁTICO");
                Logger.info("━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━");
                Logger.info("📝 ✅ Formulario llenado correctamente");
                Logger.info("━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━");
                Logger.info("👉 Revisa los datos y haz clic en 'Guardar' si te interesa");

                // Liberar flag para permitir interacción manual
                state.isFillingForm = false;
            }
        } else {
            Logger.error("❌ NO SE ENCONTRÓ BOTÓN SUBMIT");
            Logger.error("Revisa el HTML descargado para verificar el formulario");
            state.isFillingForm = false;
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

                // Reducido de 1500ms a 200ms - cada handler ahora espera sus propios elementos
                setTimeout(() => {
                    BotController._handlePageNavigation(detectedPage);
                }, 200);
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
