# Corrida de evaluación: consultations, modo salud, HEALTHCARE_1_7B_MEDICAL_Q4_K_M

## Host y carga

cpu es `Intel(R) Core(TM) Ultra 7 258V` con 8 núcleos y 15.4 GB de memoria, corriendo linux 6.6.87.2-microsoft-standard-WSL2.
La carga del modelo tomó 5849 ms.
Versión del SDK `0.19.0`, iniciada en 2026-09-11T02:41:49.144Z.

## Métricas

| Métrica | Valor |
| --- | --- |
| Filas generadas / esperadas (total) | 17 / 22 |
| Recall de filas (mediana) | 58.3% |
| Sobregeneración de filas (total) | 5 |
| Recall de valores clave | 47.2% (25/53) |
| Fundamentación numérica, salida cruda | 100.0% |
| Fundamentación numérica, tras ensamblar | 100.0% |
| Columnas por hoja (promedio) | 4.9 |
| Encabezado con concepto numérico | 50.0% |

## Cómo se puntúa

**Filas.** Cada caso trae un número de filas esperado: una por movimiento en Finanzas, una por equipo en Equipos, y en Consultas una fila de paciente más una por medicamento indicado. El recall de filas es el mínimo entre las filas generadas y las esperadas, dividido entre las esperadas; un caso que genera de más no sube el recall pero sí cuenta como sobregeneración (filas generadas de más allá de las esperadas), sumada en todos los casos.

**Recall de valores clave.** La hoja no tiene columnas fijas, así que en vez de comparar campo por campo se busca cada dato esperado en cualquier celda de la hoja generada: en Finanzas, cada monto y cada palabra de cuatro letras o más del concepto; en Equipos, cada marca, modelo, cantidad y antigüedad; en Consultas, el nombre del paciente, cada número de un signo vital, y cada medicamento con el número de su dosis. Los números exigen coincidencia exacta después de normalizar comas decimales; el texto cuenta como encontrado si aparece, sin tildes ni mayúsculas, dentro de alguna celda de texto generada.

**Fundamentación.** Mide qué proporción de las celdas numéricas tiene sus dígitos presentes en el texto de origen. La tasa 'salida cruda' se calcula sobre la respuesta JSON de la llamada de filas antes de cualquier filtro; la tasa 'tras ensamblar' usa las marcas `unverified` que el propio ensamblado calcula. Ambas deberían acercarse al 100%, porque el ensamblado ya descarta o marca lo que el texto no respalda.

**Columnas.** Se cuentan las columnas de cada hoja generada y se revisa si al menos un encabezado nombra un concepto que lleva número (monto, cantidad, dosis, temperatura, antigüedad, precio o total) en los casos donde el conjunto esperado sí tiene números; una hoja de Finanzas sin ninguna columna de monto, por ejemplo, reprueba esta métrica aunque sus filas luzcan razonables.

## Rendimiento

**Llamada de lista.** TTFT mediano 2567 ms (p90 2884 ms), velocidad mediana 25.3 tok/s, tiempo de pared mediano 8149 ms (p90 11482 ms). Tokens de entrada: 3433. Tokens generados: 1341.

**Llamada de filas.** TTFT mediano 4010 ms (p90 4693 ms), velocidad mediana 23.4 tok/s, tiempo de pared mediano 13483 ms (p90 30993 ms). Tokens de entrada: 5579. Tokens generados: 2620.

**Total por caso.** Tiempo de pared mediano 22345 ms, p90 41990 ms.
