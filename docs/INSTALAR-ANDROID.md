# V2S en Android: guía corta

**No necesitas Expo Go, Bun, compilar ni conectar el teléfono al PC.** Si falla, no necesariamente hiciste algo mal: también puede ser incompatibilidad del teléfono.

## Instalar y empezar

1. **Comprueba el teléfono:** Android **10 o superior**, con sistema **ARM64 (`arm64-v8a`)**. Este APK no se instala en iPhone ni en Android de 32 bits. No hemos determinado un mínimo de RAM ni certificado todos los teléfonos.
2. **[Abre la última release](https://github.com/tapilew/v2s/releases/latest)** y descarga **Assets → `v2s.apk`**, no «Source code». Usa **build 9 o posterior**, no una copia vieja de un chat. [Descarga directa](https://github.com/tapilew/v2s/releases/latest/download/v2s.apk). Si GitHub pide acceso, solicítalo al equipo.
3. **Espera a que termine la descarga** —build 9 pesa unos 137 MB— y abre el archivo. Si Android lo pide, permite instalar desde **ese navegador/gestor de archivos**; puedes retirar ese permiso después. **No apagues Play Protect ni eludas restricciones del administrador.**
4. **Instala o actualiza y abre V2S.** Si aparece un conflicto con una instalación anterior, **no desinstales ni borres su almacenamiento**: perderías hojas y modelos. Guarda el mensaje y pide ayuda.
5. **Empieza por Finanzas con Wi-Fi.** Deja terminar la preparación y desaparecer la banda «Cargando…». Puede tardar varios minutos. Mantén la app abierta; no pulses Reintentar repetidamente si el porcentaje sigue avanzando.

## ¿Cuándo están listos los modelos?

Toca **En el dispositivo**:

| Modo abierto | Deben estar «cargado» | Puede estar «sin cargar» |
| --- | --- | --- |
| Finanzas | Parakeet + Qwen3 | MedPsy |
| Salud | Parakeet + MedPsy | Qwen3 |

**«Sin cargar» no significa necesariamente «sin descargar».** La app retira de memoria el modelo del otro modo: no necesitas los tres cargados a la vez. El rótulo «En el dispositivo» por sí solo tampoco confirma que la preparación terminó.

Los modelos ocupan aproximadamente **399 MB + 1.06 GB + 1.28 GB = 2.74 GB** para ambos modos. Deja espacio adicional para el APK, instalación y cachés. Esto es almacenamiento, no un mínimo de RAM.

## Primera prueba

En Finanzas, elige **Destino → Nueva hoja**, escribe esto y toca **Crear hoja**:

> Pagué 27.50 de internet con tarjeta y 8 de almuerzo en efectivo.

Busca dos gastos con importes **27.50 y 8** y sus métodos de pago. El título y las columnas pueden variar. Revisa las celdas: el modelo puede equivocarse. Una biblioteca vacía antes de crear tu primera hoja es normal.

Después prueba dictado: toca su botón, permite el micrófono mientras usas la app, habla y vuelve a tocarlo para detener y transcribir. **Revisa el texto antes de enviarlo a la hoja.**

Para probar sin conexión, prepara también **Salud con Wi-Fi** primero. Luego activa modo avión y verifica que **Wi-Fi y datos móviles estén apagados**. Repite texto y voz en ambos modos y restaura tu conectividad al terminar.

Usa **datos sintéticos**, no datos reales de pacientes, clientes o cuentas. Exportar mediante otra app puede compartir información fuera del teléfono.

## Si falla, envíanos esto

```text
Teléfono y versión de Android:
Build descargado / enlace:
¿Instalación nueva o actualización?:
Falla al: descargar APK / instalar / abrir / cargar modelo / dictar / generar
Mensaje exacto y captura sin datos personales:
Modelo, porcentaje y tiempo esperando (si se queda cargando):
```

No borres datos para «probar suerte». «App no instalada» no identifica por sí solo la causa. Si la descarga se atasca, revisa espacio/conexión y guarda el error; algunas redes restringen P2P. Probar otra Wi-Fi de confianza y autorizada ayuda a distinguirlo, sin cambiar políticas de la red.

**¿Te ayuda un agente? Pásale la [guía de diagnóstico](DIAGNOSTICO-ANDROID.md)**: contiene comandos ADB, errores de instalación, sondeo de arranque y un mensaje listo para copiar.
