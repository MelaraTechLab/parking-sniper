# Parking Sniper

Bot automatizado para monitorear y notificar disponibilidad de parqueos en UVG.

## Instalación

1. Abre Chrome
2. Ve a `chrome://extensions/`
3. Activa "Modo de desarrollador" (esquina superior derecha)
4. Haz clic en "Cargar extensión sin empaquetar"
5. Selecciona la carpeta `parking-sniper`

## Cómo usar

### 1. Configurar el bot

Haz clic en el ícono de la extensión y configura:

- **Tipo de vehículo**: Automóvil o Motocicleta
- **Parqueos a monitorear** (opcional):
  - Si dejas vacío: monitoreará TODOS los parqueos
  - Si agregas nombres: solo monitoreará esos
  - **Búsqueda inteligente**: No necesitas el nombre exacto
    - ✅ "CIT" encuentra "PARQUEO CIT - T"
    - ✅ "cit" encuentra "PARQUEO CIT - T" (no importan mayúsculas)
    - ✅ "7A" encuentra "PARQUEO 7A - T"
- **Intervalo**: Cada cuántos segundos refrescar (5-120 segundos)

### 2. Iniciar el bot

1. Ve a la página de parqueos de UVG
2. Haz clic en el ícono de la extensión
3. Presiona el botón "Iniciar"
4. El bot empezará a trabajar automáticamente

### 3. Cómo te notifica

Cuando encuentra un parqueo disponible, recibes **3 notificaciones simultáneas**:

1. **🔊 Sonido de alerta**: 3 beeps ascendentes
2. **🔔 Notificación del navegador**:
   - Aparece en la esquina de tu pantalla
   - Dice "¡PARQUEO DISPONIBLE!"
   - Muestra el nombre del parqueo y cuántos espacios hay
   - Se repite 2 veces (con 3 segundos de diferencia)
3. **⚠️ Alert en pantalla**:
   - Ventana emergente en el navegador
   - Con toda la información del parqueo
   - Dice "¡Apresúrate a reservarlo!"

**IMPORTANTE**: Para que funcionen las notificaciones del navegador:
- Chrome debe tener permisos de notificación activados
- No silencies las notificaciones del navegador
- Si no ves notificaciones, igual verás el alert en pantalla

## Qué hace el bot automáticamente

El bot navega por las 3 pantallas:

1. **Pantalla de calendarios** → Hace clic en el primer calendario disponible
2. **Pantalla de tipo de vehículo** → Selecciona automóvil o moto según tu configuración
3. **Pantalla de parqueos** → Monitorea los badges "Disponibles: X"
   - Revisa cada parqueo cada X segundos
   - Si encuentra disponibilidad > 0, te notifica y se detiene

## Logs de actividad

En el panel de control puedes ver:
- Cuándo iniciaste/detuviste el bot
- Qué parqueos agregaste/eliminaste
- Cuántos espacios disponibles encontró en cada parqueo
- Cualquier error que ocurra

## Limitaciones actuales

- ✅ Monitorea disponibilidad
- ✅ Te notifica cuando hay espacios
- ⏸️ NO completa la reserva automáticamente
  - Cuando te notifica, debes hacer clic manualmente en "Comprar"
  - Esto es porque aún no tenemos las pantallas con campos de placa/modelo

## Tips

- **Intervalo recomendado**: 10-15 segundos
  - Muy rápido (< 5s): Puede ser detectado como spam
  - Muy lento (> 30s): Puedes perder el parqueo

- **Mantén la pestaña abierta**: El bot funciona en la pestaña activa

- **Sonido**: Asegúrate de que Chrome tenga sonido habilitado

- **Múltiples parqueos**: Puedes agregar varios y el bot te avisará del primero que encuentre disponible
