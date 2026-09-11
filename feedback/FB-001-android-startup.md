# FB-001 · Corregido: cierre al abrir build 1 en Pixel 9 Pro

- **Estado:** corregido y validado físicamente en build 4, en el teléfono probado.
- **Severidad original:** P0, bloqueaba la demo.
- **Reproducción original:** 10 sep 2026, 22:24, Panamá (UTC−5), 2 de 2 intentos fallidos.
- **Validación:** 10 sep 2026, 23:13–23:21, Panamá: cuatro arranques y segundo plano/reanudación aprobados.
- **Área:** arranque nativo de Android, integración Bare Kit / SoLoader.
- **Alcance:** este cierre está resuelto en el Pixel 9 Pro probado. La extracción y el flujo sin conexión siguen pendientes de validar.

## Resumen para actuar

En build 1, el APK se instalaba, pero el proceso terminaba al abrirlo, antes de poder usar la biblioteca. El primer fallo relevante era de carga nativa, no de la extracción de datos:

```text
libappmodules.so → libbare-kit.so → libnativehelper.so
                                      ↑ SoLoader no la encuentra
```

Después aparecía `PlatformConstants could not be found` y el proceso terminaba con `SIGABRT`.

**Dato importante:** `libnativehelper.so` sí existe en este teléfono, dentro del APEX de ART, y figura en la lista de bibliotecas públicas del sistema. No basta con decir «falta una biblioteca en el APK». La investigación debe empezar por cómo SoLoader resuelve esa dependencia del sistema.

**Resultado:** build 4 carga esa biblioteca mediante el cargador del sistema y supera la reproducción original. No se modificaron los prompts, las hojas ni los modelos. La evidencia del antes y después está en este informe.

## Artefacto y entorno de la reproducción original

| Dato | Valor |
| --- | --- |
| Release instalada | [`build-1`](https://github.com/tapilew/v2s/releases/tag/build-1), archivo `v2s.apk` |
| Commit | `c7296560effc64638a3c71ba526a1c04c6439c39` |
| SHA-256 del APK | `7c2cfdfa6932874b333e82744fff2ab64490be72b9620b6ad10a511a8a2051df` |
| Integridad | Coincide con el digest publicado por GitHub |
| Teléfono | Google Pixel 9 Pro |
| Sistema y ABI | Android 17, API 37, `arm64-v8a` |
| Paquete / actividad | `com.anonymous.qvacdemo` / `.MainActivity` |
| Dependencias declaradas en esa revisión | React Native `0.86.3`, Expo `~57.0.21`, `@qvac/sdk` `^0.19.0`, `react-native-bare-kit` `^0.15.0` |
| Versiones fijadas por el lockfile, relevantes al fallo | `@qvac/sdk@0.19.0`, `react-native-bare-kit@0.15.0` |
| Instalación | ADB autorizado; instalación correcta, sin conceder permisos automáticamente |

`build-2` también se publicó durante la investigación. **No se instaló ni se probó.** Su commit cambia el README respecto a `build-1`; eso no sustituye una prueba de su APK.

## Reproducción mínima

Precondiciones: instalar el APK anterior y autorizar ADB. Si hay varios dispositivos, seleccionar el teléfono con `ANDROID_SERIAL`. `ADB` permite indicar la ruta del ejecutable.

```sh
ADB="${ADB:-adb}"
APP=com.anonymous.qvacdemo

"$ADB" shell am force-stop "$APP"
"$ADB" shell am start -W -n "$APP/.MainActivity"
sleep 8
"$ADB" shell pidof "$APP"
```

**Esperado:** la app permanece abierta y muestra la biblioteca inicial o un estado de carga/error recuperable. El proceso sigue vivo.

**Observado:** la solicitud de lanzamiento devuelve `Status: ok`, pero la app se cierra. `pidof` no devuelve ningún PID. El sondeo automatizado comprobó el proceso cada segundo durante ocho segundos: estuvo ausente en las ocho observaciones, en ambos intentos. Tampoco quedó una actividad de V2S en primer plano.

No hizo falta grabar, escribir, cambiar de modo ni importar datos para reproducirlo. No se borraron datos de la aplicación. **El éxito de `am start` por sí solo no es una prueba de arranque correcto.**

## Evidencia: del primer fallo al cierre

Extractos completos de la señal, separados por intento: [`evidence/FB-001-startup.txt`](evidence/FB-001-startup.txt). Los logs se capturaron por UID de V2S, no mediante un volcado general de las otras aplicaciones del teléfono.

Orden observado en el primer intento:

1. SoLoader carga `libreactnative.so` correctamente.
2. Intenta cargar `libappmodules.so` y falla repetidamente al resolver `libnativehelper.so`.
3. JavaScript solicita `PlatformConstants`; el registro no lo encuentra.
4. El proceso termina con señal 6, `SIGABRT`.

La inspección del APK con `readelf` y `nm`, sin ejecutar sus bibliotecas en el portátil, confirmó:

```text
libappmodules.so:
  NEEDED: libbare-kit.so

libbare-kit.so:
  NEEDED: libnativehelper.so
  undefined: JNI_GetCreatedJavaVMs@LIBNATIVEHELPER_S
```

En el teléfono:

```text
/apex/com.android.art/lib64/libnativehelper.so     existe
/system/etc/public.libraries.txt                incluye libnativehelper.so
/system/lib64/libnativehelper.so                 no se encontró en la consulta
```

Las fuentes de búsqueda que muestra SoLoader en el error incluyen las bibliotecas del APK, `/system/lib64` y `/vendor/lib64`. No muestran la ruta del APEX de ART.

## Qué sabemos y qué falta demostrar

**Confirmado en la reproducción original**

- El teléfono está autorizado y ejecuta ARM64. La instalación del APK terminó correctamente.
- El cierre se reproduce sin interacción con las funciones del producto.
- Hay una dependencia ELF real de Bare Kit hacia `libnativehelper.so`.
- SoLoader no consigue resolverla durante el arranque, aunque la biblioteca existe como biblioteca pública del sistema.
- `libappmodules.so` contiene símbolos de registro, entre ellos `JNI_OnLoad`, `cxxModuleProvider` y `javaModuleProvider`. No es correcto asumir que esos símbolos faltan del APK.

**Causa validada por la corrección**

Las fuentes de directorio de SoLoader no resolvían la dependencia pública de Bare Kit alojada en APEX. El cambio añade una fuente específica para delegar esa biblioteca al cargador del sistema antes del arranque de React Native. En los cuatro arranques del APK corregido, el log confirma `Load libnativehelper.so ...: ok`, se ejecuta `main` y no reaparecen los errores de módulo faltante ni el `SIGABRT`.

**No demostrado**

- Que exista un desajuste de versiones JS/nativo o que R8 sea la causa.
- Que añadir una copia de `libnativehelper.so` al APK sea la solución correcta.
- Que el problema afecte a otras versiones de Android o a todos los teléfonos.
- Que resolver este cierre baste para completar inferencias y el flujo sin conexión en ambos modos.

## Investigación inicial, antes de implementar el cambio

1. Confirmar la versión de SoLoader **resuelta por Gradle**. React Native `0.86.3` declara `0.12.1`, pero aún no se comprobó la resolución final del APK.
2. Probar una estrategia compatible con esa versión que permita delegar la resolución de bibliotecas públicas de APEX al cargador del sistema. Mantener la inicialización y el mapeo de bibliotecas fusionadas que requiere React Native.
3. Como referencia, SoLoader `0.12.1` expone `SystemLoadWrapperSoSource`, que usa `System.loadLibrary`, y `prependSoSource`. **Esto es una pista de implementación, no un parche probado.** No copiar flags de otra versión sin comprobar que existen en la usada por el build.
4. Cambiar una sola variable, generar un APK nuevo y devolverlo a esta misma prueba física. Conservar commit, digest y resultado.

No copiar bibliotecas del sistema del teléfono al APK como primer intento, no desactivar las verificaciones de seguridad del teléfono y no sustituir QVAC por el modo de interfaz simulada para declarar resuelto el problema.

Fuentes primarias consultadas:

- [Workflow del APK instalado](https://github.com/tapilew/v2s/blob/c7296560effc64638a3c71ba526a1c04c6439c39/.github/workflows/android-apk.yml).
- [Bare Kit 0.15.0: enlace nativo de Android](https://github.com/holepunchto/react-native-bare-kit/blob/v0.15.0/android/CMakeLists.txt).
- [React Native 0.86.3: versión declarada de SoLoader](https://github.com/facebook/react-native/blob/v0.86.3/packages/react-native/gradle/libs.versions.toml).
- [SoLoader 0.12.1: inicialización y fuentes de carga](https://github.com/facebook/SoLoader/blob/v0.12.1/java/com/facebook/soloader/SoLoader.java).
- [SoLoader 0.12.1: delegación al cargador del sistema](https://github.com/facebook/SoLoader/blob/v0.12.1/java/com/facebook/soloader/SystemLoadWrapperSoSource.java).

## Corrección implementada

`plugins/with-nativehelper-loader.js`, registrado en `app.json`, instala una fuente de SoLoader que delega **solo** `libnativehelper.so` al cargador del sistema. Se inicializa con `OpenSourceMergedSoMapping` antes del arranque de React Native. Las demás bibliotecas siguen por las fuentes existentes. No se cambiaron dependencias, modelos, prompts ni comportamiento de las hojas.

Comprobaciones locales del candidato:

- 41 pruebas existentes aprobadas (`bun test src`).
- TypeScript y Biome de la app y el plugin aprobados.
- Dos ejecuciones de Expo prebuild generaron el mismo `MainApplication.kt`, con un único bloque antes de `loadReactNative(this)`.
- `package.json` y `bun.lock` permanecieron sin cambios.
- El nuevo sondeo persistente `scripts/smoke-android-startup.py` se ejecutó contra build 1 y falló con el mismo error nativo y `SIGABRT` antes de probar el candidato.

Sondeo para el APK nuevo:

```sh
ADB=/ruta/a/adb ANDROID_SERIAL=<telefono> python3 scripts/smoke-android-startup.py
```

## Validación física de la corrección

| Dato | Resultado |
| --- | --- |
| APK probado | [`build-4`](https://github.com/tapilew/v2s/releases/tag/build-4) |
| Commit | `d0251c2a4c9777346bdfe44679db0c3e37a0f8e6` |
| SHA-256 | `55d4a51351acca2779f6206cc419eda51ea125de018aa61ff058b91092e057b7` |
| Build | [GitHub Actions, ejecución 34560690984](https://github.com/tapilew/v2s/actions/runs/34560690984), aprobada |
| Instalación | Actualización con datos y permisos conservados; digest del APK instalado comprobado |
| Arranque 1 | Aprobado: 30 observaciones de un segundo, proceso vivo y app en primer plano |
| Arranques 2 y 3 | Aprobados: ocho observaciones de un segundo en cada intento |
| Reproducción original | Reejecutada sin cambiar su criterio: aprobada, ocho observaciones; cuarto arranque independiente |
| Segundo plano/reanudación | Aprobado; mismo proceso vivo y app en primer plano tras volver |
| Interfaz | Biblioteca vacía visible; progreso de descarga de Qwen3 observado |
| Errores originales | Ausentes en los cuatro arranques; resolución de `libnativehelper.so` confirmada en todos |

Resumen verificable, sin identificadores personales del teléfono: [`evidence/FB-001-startup-fixed.json`](evidence/FB-001-startup-fixed.json).

## Criterios de cierre cumplidos

- [x] Registrar release, commit y SHA-256 del APK candidato.
- [x] Instalarlo sin perder datos existentes ni cambiar permisos.
- [x] Superar al menos tres arranques desde proceso detenido en el Pixel 9 Pro probado.
- [x] Mostrar la biblioteca inicial/carga de modelos y mantenerse abierta al menos treinta segundos.
- [x] No repetir los fallos de `libnativehelper.so`, `PlatformConstants` ni `SIGABRT`.
- [x] Volver del segundo plano sin cierre inesperado.

Estos resultados provienen del APK instalado en el teléfono, no solo de una compilación verde o de Expo Go.

## Pruebas de producto pendientes después del arranque

El cierre ya no bloquea estas pruebas. Se observó progreso de descarga en Finanzas y el usuario confirmó que sus modelos estaban listos; eso no equivale a validar la inferencia. El resto sigue **sin validación completa**, no aprobado ni reportado como defecto:

| Prueba | Qué hay que observar |
| --- | --- |
| Primera descarga en ambos modos | Progreso visible, finalización y recuperación ante errores sin cierre |
| Voz | Permiso de micrófono y transcripción añadida al texto existente |
| Nueva hoja | Biblioteca inicialmente vacía; columnas y filas generadas desde datos sintéticos |
| Hoja existente | Añadir filas sin sustituir las anteriores ni cambiar su esquema |
| Edición y persistencia | Editar una celda, cerrar y reabrir, comprobar que se conserva |
| Exportación | Compartir `<nombre>.csv`; volver a leerlo y verificar columnas, filas, acentos y comillas |
| Modo avión | Tras descargar todos los modelos necesarios, repetir voz y generación real en Finanzas y Salud, con Wi-Fi y datos móviles apagados |

Hasta completar esa última prueba no hay evidencia física de la promesa central: convertir voz o texto en hojas con inferencia en el dispositivo y sin conexión.
