import csv
from datetime import date, datetime
from pathlib import Path
import requests
from openpyxl import Workbook
from openpyxl.chart import BarChart, PieChart, Reference
from openpyxl.styles import Font
from openpyxl.worksheet.table import Table, TableStyleInfo

BASE_DIR = Path(__file__).resolve().parent
HISTORIAL_DIR = BASE_DIR / "historial_productos"
ARCHIVO_CSV = BASE_DIR / "productos_datax_dataset.csv"
URL_CATALOGO = "https://datax.com.bo/analyze/productos-categoria/?search="
URL_AJAX = "https://datax.com.bo/wp-admin/admin-ajax.php"

CAMPOS_CSV = [
    "Número",
    "ID",
    "Nombre del Producto",
    "Sigla Institución",
    "Periodicidad",
    "Etiquetas",
    "Descripción",
    "Fecha",
    "Última fecha disponible",
    "Estado de actualización",
    "URL",
]

PERIODICIDAD_DIAS = {
    "diaria": 1,
    "diario": 1,
    "semanal": 7,
    "semanalmente": 7,
    "mensual": 30,
    "bimestral": 60,
    "trimestral": 90,
    "cuatrimestral": 120,
    "semestral": 182,
    "anual": 365,
}


def estado_actualizacion(fecha_texto, periodicidad, hoy=None):
    """Determina el estado del producto según su ciclo de actualización."""
    if not fecha_texto:
        return "Sin fecha"

    fecha = None
    for formato in ("%Y-%m-%d", "%d-%m-%Y", "%Y/%m/%d", "%d/%m/%Y"):
        try:
            fecha = datetime.strptime(fecha_texto[:10], formato).date()
            break
        except ValueError:
            continue
    if fecha is None:
        return "Sin fecha"

    ciclo = PERIODICIDAD_DIAS.get(periodicidad.strip().lower())
    if ciclo is None:
        return "Periodicidad no reconocida"

    hoy = hoy or date.today()
    dias_transcurridos = (hoy - fecha).days
    if dias_transcurridos > ciclo:
        return "Atrasado"
    if dias_transcurridos >= ciclo * 0.8:
        return "Próximo a vencer"
    return "Al día"


def cargar_snapshot(ruta):
    """Carga un snapshot CSV indexado por el ID único del dataset."""
    with ruta.open(mode="r", newline="", encoding="utf-8-sig") as file:
        snapshots = {}
        for fila in csv.DictReader(file, delimiter=";"):
            # Compatibilidad con snapshots creados antes de esta columna.
            fila.setdefault("Última fecha disponible", fila.get("Fecha", ""))
            fila.setdefault(
                "Estado de actualización",
                estado_actualizacion(fila.get("Fecha", ""), fila.get("Periodicidad", "")),
            )
            snapshots[fila["ID"]] = fila
        return snapshots


def guardar_comparacion(anterior, actual, ruta_anterior, ruta_actual, ruta_excel):
    """Genera un reporte Excel con las diferencias detectadas."""
    ids_nuevos = sorted(set(actual) - set(anterior))
    ids_eliminados = sorted(set(anterior) - set(actual))
    ids_actualizados = sorted(
        _id
        for _id in (set(actual) & set(anterior))
        if any(
            actual[_id][c] != anterior[_id][c]
            for c in (
                "Descripción",
                "Fecha",
                "Nombre del Producto",
                "Sigla Institución",
                "Periodicidad",
                "Etiquetas",
            )
        )
    )
    ids_no_actualizados = sorted(
        _id for _id in (set(actual) & set(anterior)) if _id not in ids_actualizados
    )

    libro = Workbook()

    # Hoja de Resumen
    resumen = libro.active
    resumen.title = "Resumen"
    resumen.append(["Tipo", "Cantidad"])
    resumen.append(["Nuevos", len(ids_nuevos)])
    resumen.append(["Actualizados", len(ids_actualizados)])
    resumen.append(["Eliminados", len(ids_eliminados)])
    resumen.append([])
    resumen.append(
        ["Archivo anterior", str(ruta_anterior) if ruta_anterior else "No existe"]
    )
    resumen.append(["Archivo actual", str(ruta_actual)])
    resumen.append(
        ["Fecha de comparación", datetime.now().strftime("%Y-%m-%d %H:%M:%S")]
    )

    # Hoja de Nuevos
    hoja_nuevos = libro.create_sheet("Nuevos")
    hoja_nuevos.append(CAMPOS_CSV)
    for _id in ids_nuevos:
        fila = actual[_id]
        hoja_nuevos.append([fila[col] for col in CAMPOS_CSV])

    # Hoja de Actualizados
    hoja_actualizados = libro.create_sheet("Actualizados")
    hoja_actualizados.append([
        "ID",
        "Nombre del Producto",
        "Sigla",
        "Periodicidad",
        "Fecha Anterior",
        "Fecha Actual",
        "Descripción Anterior",
        "Descripción Actual",
        "Estado Anterior",
        "Estado Actual",
        "Etiquetas Anterior",
        "Etiquetas Actual",
    ])
    for _id in ids_actualizados:
        viejo = anterior[_id]
        nuevo = actual[_id]
        hoja_actualizados.append([
            _id,
            nuevo["Nombre del Producto"],
            nuevo["Sigla Institución"],
            nuevo["Periodicidad"],
            viejo["Fecha"],
            nuevo["Fecha"],
            viejo["Descripción"],
            nuevo["Descripción"],
            viejo.get("Estado de actualización", ""),
            nuevo.get("Estado de actualización", ""),
            viejo["Etiquetas"],
            nuevo["Etiquetas"],
        ])

    # Hoja de Eliminados
    hoja_eliminados = libro.create_sheet("Eliminados")
    hoja_eliminados.append(CAMPOS_CSV)
    for _id in ids_eliminados:
        fila = anterior[_id]
        hoja_eliminados.append([fila[col] for col in CAMPOS_CSV])

    hoja_no_actualizados = libro.create_sheet("No actualizados")
    hoja_no_actualizados.append(CAMPOS_CSV)
    for _id in ids_no_actualizados:
        fila = actual[_id]
        hoja_no_actualizados.append([fila[col] for col in CAMPOS_CSV])

    # Estilos y anchos de columnas
    for hoja in libro.worksheets:
        hoja.freeze_panes = "A2"
        for celda in hoja[1]:
            celda.font = Font(bold=True)
        for columna in hoja.columns:
            ancho = max(len(str(celda.value or "")) for celda in columna) + 2
            hoja.column_dimensions[columna[0].column_letter].width = min(ancho, 60)

    # Tablas con filtros para explorar los detalles desde Excel.
    for indice, hoja in enumerate(
        (hoja_nuevos, hoja_actualizados, hoja_eliminados, hoja_no_actualizados), start=1
    ):
        if hoja.max_row > 1:
            tabla = Table(
                displayName=f"TablaCambios{indice}",
                ref=f"A1:{hoja.cell(hoja.max_row, hoja.max_column).coordinate}",
            )
            tabla.tableStyleInfo = TableStyleInfo(
                name="TableStyleMedium2",
                showFirstColumn=False,
                showLastColumn=False,
                showRowStripes=True,
                showColumnStripes=False,
            )
            hoja.add_table(tabla)

    # Dashboard con indicadores, navegación y gráficos vinculados al resumen.
    dashboard = libro.create_sheet("Dashboard", 0)
    dashboard["A1"] = "Dashboard de cambios de productos"
    dashboard["A1"].font = Font(bold=True, size=16)
    dashboard["A3"] = "Indicador"
    dashboard["B3"] = "Cantidad"
    for celda in dashboard[3]:
        celda.font = Font(bold=True)

    indicadores = (
        ("Nuevos", len(ids_nuevos), "Resumen!B2"),
        ("Actualizados", len(ids_actualizados), "Resumen!B3"),
        ("Eliminados", len(ids_eliminados), "Resumen!B4"),
        ("No actualizados", len(ids_no_actualizados), "No actualizados!A1"),
    )
    for fila, (nombre, cantidad, referencia) in enumerate(indicadores, start=4):
        dashboard.cell(fila, 1, nombre)
        dashboard.cell(fila, 2, cantidad)
        dashboard.cell(fila, 2).hyperlink = f"#{referencia}"
        dashboard.cell(fila, 2).style = "Hyperlink"

    dashboard["D3"] = "Navegación"
    dashboard["D3"].font = Font(bold=True)
    for fila, nombre_hoja in enumerate(
        ("Resumen", "Nuevos", "Actualizados", "Eliminados", "No actualizados"), start=4
    ):
        dashboard.cell(fila, 4, f"Ir a {nombre_hoja}")
        dashboard.cell(fila, 4).hyperlink = f"#'{nombre_hoja}'!A1"
        dashboard.cell(fila, 4).style = "Hyperlink"

    grafico_barras = BarChart()
    grafico_barras.type = "col"
    grafico_barras.style = 10
    grafico_barras.title = "Cambios detectados"
    grafico_barras.y_axis.title = "Cantidad"
    grafico_barras.x_axis.title = "Tipo"
    datos = Reference(dashboard, min_col=2, min_row=3, max_row=7)
    categorias = Reference(dashboard, min_col=1, min_row=4, max_row=7)
    grafico_barras.add_data(datos, titles_from_data=True)
    grafico_barras.set_categories(categorias)
    grafico_barras.height = 7
    grafico_barras.width = 12
    dashboard.add_chart(grafico_barras, "A9")

    grafico_torta = PieChart()
    grafico_torta.title = "Distribución de cambios"
    grafico_torta.add_data(datos, titles_from_data=True)
    grafico_torta.set_categories(categorias)
    grafico_torta.height = 7
    grafico_torta.width = 10
    dashboard.add_chart(grafico_torta, "N9")

    dashboard.freeze_panes = "A4"
    dashboard.column_dimensions["A"].width = 22
    dashboard.column_dimensions["B"].width = 14
    dashboard.column_dimensions["D"].width = 24

    libro.save(ruta_excel)
    return len(ids_nuevos), len(ids_actualizados), len(ids_eliminados)


def main():
    payload = {
        "action": "set_data_datax_elasticsearch_v3",
        "search_param": "",
    }
    headers = {
        "User-Agent": (
            "Mozilla/5.0 (Windows NT 10.0; Win64; x64) "
            "AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36"
        ),
        "Referer": URL_CATALOGO,
    }

    print("Enviando petición a la API interna de DataX...")
    try:
        response = requests.post(URL_AJAX, data=payload, headers=headers, timeout=30)
        response.raise_for_status()
        data_json = response.json()
    except Exception as err:
        print(f"Error al obtener datos: {err}")
        return

    items = data_json.get("data", {}).get("data", [])
    if not items:
        print("No se encontraron registros en la respuesta.")
        return

    # Filtrar únicamente productos correspondientes a la categoría 'Dataset'
    datasets = [p for p in items if "Dataset" in str(p.get("categories", ""))]
    print(f"Se obtuvieron {len(datasets)} datasets (de un total de {len(items)} productos).")

    filas_actuales = []
    for idx, item in enumerate(datasets, 1):
        # Procesar lista de etiquetas (product_tags es un array de objetos o strings)
        raw_tags = item.get("product_tags", [])
        if isinstance(raw_tags, list):
            tags_parsed = [
                t.get("name", "").strip() if isinstance(t, dict) else str(t).strip()
                for t in raw_tags
            ]
            etiquetas_str = ", ".join(filter(None, tags_parsed))
        else:
            etiquetas_str = str(raw_tags or "").strip()

        filas_actuales.append({
            "Número": idx,
            "ID": str(item.get("ID", "")).strip(),
            "Nombre del Producto": str(item.get("post_title", "")).strip(),
            "Sigla Institución": str(item.get("siglafuente_slugs", "")).strip(),
            "Periodicidad": str(item.get("frequency_slugs", "")).strip(),
            "Etiquetas": etiquetas_str,
            "Descripción": str(item.get("post_content", "")).strip(),
            "Fecha": str(item.get("update_date", "")).strip(),
            "Última fecha disponible": str(item.get("update_date", "")).strip(),
            "Estado de actualización": estado_actualizacion(
                str(item.get("update_date", "")).strip(),
                str(item.get("frequency_slugs", "")).strip(),
            ),
            "URL": str(item.get("post_url", "")).strip(),
        })

    # Guardar CSV base y Snapshot histórico
    HISTORIAL_DIR.mkdir(exist_ok=True)
    marca_tiempo = datetime.now().strftime("%Y%m%d_%H%M%S")
    archivo_snapshot = HISTORIAL_DIR / f"productos_{marca_tiempo}.csv"

    for ruta_archivo in (ARCHIVO_CSV, archivo_snapshot):
        with ruta_archivo.open(mode="w", newline="", encoding="utf-8-sig") as file:
            writer = csv.DictWriter(file, fieldnames=CAMPOS_CSV, delimiter=";")
            writer.writeheader()
            writer.writerows(filas_actuales)

    # Comparación histórica por ID
    snapshots_anteriores = sorted(HISTORIAL_DIR.glob("productos_*.csv"))
    ruta_anterior = snapshots_anteriores[-2] if len(snapshots_anteriores) > 1 else None
    anterior = cargar_snapshot(ruta_anterior) if ruta_anterior else {}
    actual = cargar_snapshot(archivo_snapshot)

    archivo_excel = BASE_DIR / f"comparacion_productos_{marca_tiempo}.xlsx"
    nuevos, actualizados, eliminados = guardar_comparacion(
        anterior, actual, ruta_anterior, archivo_snapshot, archivo_excel
    )

    print(f"\n¡Completado con éxito!")
    print(f"CSV principal: '{ARCHIVO_CSV}'")
    print(f"Snapshot: '{archivo_snapshot}'")
    print(f"Reporte Excel: '{archivo_excel}'")
    print(f"Balance de cambios: {nuevos} nuevos, {actualizados} actualizados, {eliminados} eliminados.")


if __name__ == "__main__":
    main()
