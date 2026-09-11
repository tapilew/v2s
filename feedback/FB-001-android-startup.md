# FB-001 · P0: build 1 se cierra al abrir en Pixel 9 Pro

- **Estado:** reproducido 2 de 2 veces en build 1. Candidato de corrección implementado; pendiente de validar en un APK nuevo.
- **Fecha:** 10 sep 2026, 22:24, Panamá (UTC−5).
- **Área propuesta:** arranque nativo de Android, integración Bare Kit / SoLoader.
- **Impacto:** bloquea la demo en el teléfono probado. No demuestra que fallen todos los Android.

## Resumen para actuar

El APK se instala, pero el proceso termina al abrirlo, antes de poder usar la biblioteca. El primer fallo relevante es de carga nativa, no de la extracción de datos:

```text
libappmodules.so → libbare-kit.so → libnativehelper.so
                                      ↑ SoLoader no la encuentra
```

Después aparece `PlatformConstants could not be found` y el proceso termina con `SIGABRT`.

**Dato importante:** `libnativehelper.so` sí existe en este teléfono, dentro del APEX de ART, y figura en la lista de bibliotecas públicas del sistema. No basta con decir «falta una biblioteca en el APK». La investigación debe empezar por cómo SoLoader resuelve esa dependencia del sistema.

**Siguiente entrega útil:** un APK nuevo, identificado por commit, con un cambio acotado en la carga nativa y sometido al mismo arranque en este teléfono. No empezar modificando los prompts, las hojas o los modelos.

## Artefacto y entorno exactos

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

**Confirmado**

- El teléfono está autorizado y ejecuta ARM64. La instalación del APK terminó correctamente.
- El cierre se reproduce sin interacción con las funciones del producto.
- Hay una dependencia ELF real de Bare Kit hacia `libnativehelper.so`.
- SoLoader no consigue resolverla durante el arranque, aunque la biblioteca existe como biblioteca pública del sistema.
- `libappmodules.so` contiene símbolos de registro, entre ellos `JNI_OnLoad`, `cxxModuleProvider` y `javaModuleProvider`. No es correcto asumir que esos símbolos faltan del APK.

**Hipótesis principal, todavía sin prueba de corrección**

La resolución de bibliotecas de SoLoader no alcanza esta dependencia pública alojada en APEX. Eso impide completar la carga de `libappmodules.so` y deja incompleto el registro de módulos de React Native. Explica el orden de los errores, pero falta demostrarlo con un APK corregido.

**No demostrado**

- Que exista un desajuste de versiones JS/nativo o que R8 sea la causa.
- Que añadir una copia de `libnativehelper.so` al APK sea la solución correcta.
- Que el problema afecte a otras versiones de Android o a todos los teléfonos.
- Que resolver este cierre baste para que QVAC cargue modelos o complete inferencias.

## Investigación recomendada para quien genera el APK

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

## Candidato de corrección

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

**Pendiente:** compilación del APK candidato y validación física. Estos checks locales no demuestran que el cierre esté corregido.

## Criterios para cerrar este bloqueo

- [ ] Registrar release, commit y SHA-256 del APK candidato.
- [ ] Instalarlo sin perder datos existentes; si cambia la firma y requiere desinstalar, pedir autorización antes.
- [ ] Superar tres arranques desde proceso detenido en este Pixel 9 Pro: proceso vivo y V2S en primer plano tras ocho segundos.
- [ ] Mostrar la biblioteca inicial o una carga de modelos manejada por la interfaz y mantenerse abierta al menos treinta segundos.
- [ ] No repetir el fallo de carga de `libnativehelper.so`, el error de `PlatformConstants` ni el `SIGABRT` en los logs de esos intentos.
- [ ] Volver del segundo plano sin cierre inesperado.

Una compilación verde o una prueba en Expo Go no cumplen estos criterios.

## Pruebas de producto pendientes después del arranque

Estas pruebas están **bloqueadas o no ejecutadas**, no aprobadas ni reportadas como defectos:

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
