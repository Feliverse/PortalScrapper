# PortalScrapper v2

Scraper para obtener los productos de la categoría **Dataset** publicados en
[DataX Bolivia](https://datax.com.bo/analyze/productos-categoria/?search=).

La versión `v2` consulta directamente el endpoint AJAX utilizado por el
catálogo y genera un CSV actualizado, un snapshot histórico y un reporte Excel
con los cambios detectados frente al snapshot anterior.

## Requisitos

- Python 3.10 o superior
- Paquetes Python:
  - `requests`
  - `openpyxl`

Instalación:

```powershell
py -m pip install requests openpyxl
```

## Ejecución

Desde cualquier carpeta, ejecutar:

```powershell
py "C:\ruta\al\proyecto\v2\PortalScrapper.py"
```

El programa guarda todos los archivos junto al script, dentro de la carpeta
`v2`, independientemente de la carpeta desde la que se ejecute.

## Dashboard React

El dashboard local permite ejecutar la v2, consultar el CSV principal, revisar
las reglas de vigencia, descargar snapshots y reportes Excel, y convertir el
CSV actual a un libro Excel.

Instalar y construir el frontend:

```powershell
cd "C:\ruta\al\proyecto\frontend"
npm install
npm run build
```

Iniciar la API y el dashboard:

```powershell
cd "C:\ruta\al\proyecto"
py server.py
```

Abrir `http://localhost:8000`. La API ejecuta el scraper con el mismo
intérprete de Python que inició el servidor y conserva los archivos dentro de
`v2`.

## Fuente de datos

- Catálogo: `https://datax.com.bo/analyze/productos-categoria/?search=`
- Endpoint AJAX: `https://datax.com.bo/wp-admin/admin-ajax.php`
- Acción utilizada: `set_data_datax_elasticsearch_v3`

El scraper solicita todos los productos y conserva únicamente aquellos cuya
categoría contiene `Dataset`.

## Archivos generados

### CSV principal

`productos_datax_dataset.csv` contiene el estado más reciente del catálogo.
Utiliza punto y coma (`;`) como separador y codificación `UTF-8 con BOM` para
facilitar su apertura en Excel.

Columnas:

| Columna | Descripción |
|---|---|
| `Número` | Posición del registro en la respuesta actual |
| `ID` | Identificador único del producto en DataX |
| `Nombre del Producto` | Nombre publicado |
| `Sigla Institución` | Identificador de la institución fuente |
| `Periodicidad` | Frecuencia de actualización |
| `Etiquetas` | Etiquetas asociadas al producto |
| `Descripción` | Descripción del dataset |
| `Fecha` | Fecha de actualización publicada |
| `Última fecha disponible` | Última fecha disponible informada por DataX |
| `Estado de actualización` | Estado calculado según fecha, periodicidad y fecha actual |
| `URL` | Enlace al producto |

El estado puede ser `Al día`, `Próximo a vencer`, `Atrasado`, `Sin fecha` o
`Periodicidad no reconocida`. `Próximo a vencer` corresponde al último 20% del
ciclo esperado. Los ciclos aproximados son: mensual (30 días), bimestral (60),
trimestral (90), cuatrimestral (120), semestral (182) y anual (365).

### Snapshots históricos

Se almacenan en `historial_productos/` con el formato:

```text
productos_YYYYMMDD_HHMMSS.csv
```

La comparación histórica se realiza utilizando `ID` como clave.

### Reporte Excel

Se crea un archivo con el formato:

```text
comparacion_productos_YYYYMMDD_HHMMSS.xlsx
```

El libro contiene estas hojas:

- **Dashboard:** indicadores, gráficos y enlaces de navegación a las hojas de
  detalle.
- **Resumen:** cantidades de registros nuevos, actualizados y eliminados.
- **Nuevos:** productos que no existían en el snapshot anterior.
- **Actualizados:** cambios en descripción, fecha, nombre, institución,
  periodicidad o etiquetas.
- **Eliminados:** productos presentes en el snapshot anterior que ya no están
  en la respuesta actual.
- **No actualizados:** productos presentes en ambos snapshots sin cambios en
  los campos comparados.

Las hojas de detalle se crean como tablas de Excel con filtros y filas
alternadas. Desde el `Dashboard` se puede hacer clic en los indicadores para
ir al resumen o en los enlaces de navegación para abrir cada hoja.

## Ejemplo de salida

```text
Se obtuvieron 570 datasets (de un total de 585 productos).

¡Completado con éxito!
Balance de cambios: 0 nuevos, 229 actualizados, 0 eliminados.
```

## Notas operativas

- La primera ejecución no tiene un snapshot anterior; por eso no permite una
  comparación histórica útil.
- No borrar manualmente los archivos de `historial_productos/` si se desea
  conservar la trazabilidad de cambios.
- Si DataX cambia el nombre de la acción AJAX o la estructura de la respuesta,
  será necesario actualizar `PortalScrapper.py`.
- El archivo `scrapper.py` ubicado en la carpeta raíz corresponde a una versión
  anterior basada en Selenium. Para el proceso actual debe utilizarse
  `v2/PortalScrapper.py`.
