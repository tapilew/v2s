# V2S Android: diagnóstico para agentes

Primero lee la [guía corta](INSTALAR-ANDROID.md). Distingue **instalación**, **arranque**, **carga de modelos** e **inferencia**: que pase una etapa no valida las siguientes. Aún no tenemos un error reproducido de cada teléfono que falla; no asumas una causa común.

## APK y alcance de las pruebas

- **Build 4:** corrigió el arranque por `libnativehelper.so`; cuatro lanzamientos y segundo plano/reanudación aprobados en Pixel 9 Pro, Android 17. [Evidencia](../feedback/FB-001-android-startup.md).
- **[Build 5](https://github.com/tapilew/v2s/releases/tag/build-5):** añadió OpenCL opcional para no exigir esa biblioteca al instalar. No hereda automáticamente la validación física de build 4.
- Para usuarios nuevos, usa **build 5 o posterior**. No prometas compatibilidad universal. Estas revisiones muestran versión `1.0.0`: identifica **release, commit y SHA-256**, no solo ese número ni el nombre `v2s.apk`.

## Recoger información sin modificar datos

Necesitas [Platform-Tools oficiales](https://developer.android.com/tools/releases/platform-tools), Python 3 y una copia del repo. **No necesitas instalar dependencias JS para el sondeo.**

Pide autorización para depurar por USB. Usa un cable de datos y acepta en el teléfono únicamente la clave del PC de confianza. `unauthorized` requiere esa autorización; si no aparece el teléfono, revisa cable/conexión/controlador antes de culpar al APK. No eludas políticas de un dispositivo administrado.

Desde la raíz del repo, en **Bash (Linux/macOS)**, sustituye rutas y serial:

```sh
export ADB=adb  # o ruta al ejecutable
"$ADB" devices -l
export ANDROID_SERIAL="SERIAL_DE_TU_TELEFONO"
APK="/ruta/al/v2s.apk"

"$ADB" get-state  # debe decir device
"$ADB" shell getprop ro.product.model
"$ADB" shell getprop ro.build.version.release
"$ADB" shell getprop ro.build.version.sdk
"$ADB" shell getprop ro.product.cpu.abilist
"$ADB" shell df -h /data
"$ADB" shell 'grep MemTotal /proc/meminfo'
```

**Antes de instalar**, compara el SHA-256 local con el digest del asset de esa misma release. Con GitHub CLI (`gh`), cambiando la etiqueta si corresponde:

```sh
gh api repos/tapilew/v2s/releases/tags/build-5 \
  --jq '{tag: .tag_name, commit: .target_commitish, assets: [.assets[] | select(.name == "v2s.apk") | {name, size, digest}]}'
sha256sum "$APK"  # macOS: shasum -a 256 "$APK"
```

## Instalar y probar el arranque

**Avisa antes:** actualizar o ejecutar el sondeo puede interrumpir grabaciones, descargas, generación y borradores sin guardar. Espera a que el dueño esté listo.

Después de verificar el archivo:

```sh
"$ADB" install -r "$APK" && \
  python3 scripts/smoke-android-startup.py --seconds 30
```

`-r` solicita actualizar conservando datos. **Si falla, detente y conserva el error literal.** El `&&` evita probar por accidente el APK anterior. No añadas desinstalación, `pm clear`, downgrade ni opciones para saltarte restricciones.

En **PowerShell**, con `adb` y Python en PATH:

```powershell
$env:ANDROID_SERIAL = "SERIAL_DE_TU_TELEFONO"
Get-FileHash "C:\ruta\v2s.apk" -Algorithm SHA256
# Compara el hash con GitHub antes de continuar.
adb install -r "C:\ruta\v2s.apk"
if ($LASTEXITCODE -eq 0) { python scripts/smoke-android-startup.py --seconds 30 }
```

El sondeo **detiene y vuelve a abrir V2S**, sin borrar sus archivos. Deja el teléfono desbloqueado, V2S en pantalla y no interactúes durante la prueba. Imprime la carpeta temporal con `result.json`, `launch.txt` y `app-startup.log`; los logs se filtran por UID de V2S.

| Resultado | Interpretación |
| --- | --- |
| Exit 0 / PASS | Sobrevivió al sondeo y estaba en primer plano al final. No valida modelos ni inferencia. |
| Exit 1 / FAIL | No cumplió el criterio. Revisa PID, primer plano y errores: perder el primer plano no equivale necesariamente a un crash. |
| Exit 2 / INCONCLUSIVE | Falló la preparación o conexión. No confirma un defecto del producto. |

Para cerrar un fallo de arranque: al menos tres lanzamientos, biblioteca/carga visible durante 30 segundos, ausencia del error original y regreso del segundo plano. Para un fallo posterior, reproduce **su acción exacta**, no solo el arranque.

## Interpretar el error preciso

| Error o síntoma | Siguiente comprobación |
| --- | --- |
| «App no instalada» / «paquete no válido» | Mensaje genérico: captura el error completo de `adb install`, identifica APK y confirma descarga íntegra. |
| `INSTALL_FAILED_NO_MATCHING_ABIS` | El APK necesita `arm64-v8a` en las ABI del sistema, no solo un procesador anunciado como 64 bits. No es para x86 o Android de 32 bits. |
| `INSTALL_FAILED_OLDER_SDK` | Mínimo declarado: API 29 (Android 10). |
| `INSTALL_FAILED_UPDATE_INCOMPATIBLE` | Conflicto de firma/instalación previa. Pide APK firmado con la misma clave; cualquier desinstalación exige respaldo y autorización explícita. |
| `INSTALL_FAILED_VERSION_DOWNGRADE` | Identifica ambas versiones antes de actuar; no fuerces la bajada. |
| `INSTALL_FAILED_MISSING_SHARED_LIBRARY` con `libOpenCL.so` | Comprueba que realmente usas build 5 o posterior. Conserva el error; no copies bibliotecas del sistema al APK. |
| `INSTALL_FAILED_INSUFFICIENT_STORAGE` | Espacio libre; no borres automáticamente el almacenamiento de V2S. |
| `INSTALL_FAILED_USER_RESTRICTED` | Permisos/política: consulta al dueño o administrador, no los eludas. |
| Se cierra al cargar/generar | Recoge modelo, acción, RAM, espacio y log. No atribuyas falta de memoria o error nativo sin evidencia. |
| No transcribe, no genera o genera datos incorrectos | Guarda error y ejemplo sintético. No declares resuelto el caso porque la app abre. |

Si debes compilar, sigue el [workflow](../.github/workflows/android-apk.yml) y conserva ambos plugins nativos, incluido su orden. Si Bun rechaza `bun.lock`, usa una versión compatible (1.4.2 se comprobó aquí); no regeneres el lockfile para ocultarlo. **Expo Go y `EXPO_PUBLIC_UI_ONLY=true` no prueban el arreglo.** La inferencia real debe seguir en `@qvac/sdk`, en el teléfono.

## Entrega y privacidad

Devuelve teléfono/Android/ABI, RAM y espacio si son relevantes, release/commit/hash, etapa y pasos exactos, error literal, resultado esperado/observado y evidencia mínima. Separa **hechos, hipótesis y pruebas pendientes**. No publiques el serial ni IMEI.

Si la app abre, **En el dispositivo → Compartir registro de rendimiento** puede ayudar: **incluye el texto de entrada**. Revisa y anonimiza registros/capturas: datos personales, tokens y rutas con nombres de usuario. No publiques un logcat de todas las apps. Ni el UID ni la redacción automática garantizan quitar todo dato sensible. Al terminar, permite al dueño revocar la autorización del PC.

### Mensaje para pegarle a un agente

> Ayúdame a instalar y ejecutar el APK oficial del repo https://github.com/tapilew/v2s. Lee `docs/INSTALAR-ANDROID.md` y `docs/DIAGNOSTICO-ANDROID.md`. Identifica teléfono/Android/ABI, APK exacto y etapa que falla. Obtén un error reproducible antes de proponer cambios. No borres datos, desinstales ni eludas protecciones. Pide autorización antes de interrumpir trabajo o cambiar configuración. Usa datos sintéticos y evidencia mínima redactada; verifica el resultado en el dispositivo. Mantén la inferencia real en QVAC y no declares éxito por una compilación o una UI simulada.
