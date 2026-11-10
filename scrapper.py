import time
import csv
from datetime import datetime
from pathlib import Path

from openpyxl import Workbook
from openpyxl.styles import Font
from selenium import webdriver
from selenium.webdriver.common.by import By
from selenium.webdriver.chrome.service import Service
from webdriver_manager.chrome import ChromeDriverManager
from selenium.webdriver.support.ui import WebDriverWait
from selenium.webdriver.support import expected_conditions as EC


HISTORIAL_DIR = Path("historial_productos")
ARCHIVO_CSV = Path("productos_datax_dataset.csv")


def cargar_snapshot(ruta):
    """Carga un snapshot indexado por el nombre del producto."""
    with ruta.open(mode="r", newline="", encoding="utf-8-sig") as file:
        return {
            fila["Nombre del Producto"]: fila
            for fila in csv.DictReader(file, delimiter=";")
        }


def guardar_comparacion(anterior, actual, ruta_anterior, ruta_actual, ruta_excel):
    nombres_nuevos = sorted(set(actual) - set(anterior))
    nombres_eliminados = sorted(set(anterior) - set(actual))
    nombres_actualizados = sorted(
        nombre
        for nombre in set(actual) & set(anterior)
        if any(
            actual[nombre][campo] != anterior[nombre][campo]
            for campo in ("Descripción", "Fecha")
        )
    )

    libro = Workbook()
    resumen = libro.active
    resumen.title = "Resumen"
    resumen.append(["Tipo", "Cantidad"])
    resumen.append(["Nuevos", len(nombres_nuevos)])
    resumen.append(["Actualizados", len(nombres_actualizados)])
    resumen.append(["Eliminados", len(nombres_eliminados)])
    resumen.append([])
    resumen.append(["Archivo anterior", str(ruta_anterior) if ruta_anterior else "No existe"])
    resumen.append(["Archivo actual", str(ruta_actual)])
    resumen.append(["Fecha de comparación", datetime.now().strftime("%Y-%m-%d %H:%M:%S")])

    hoja_nuevos = libro.create_sheet("Nuevos")
    hoja_nuevos.append(["Número", "Nombre del Producto", "Descripción", "Fecha"])
    for nombre in nombres_nuevos:
        fila = actual[nombre]
        hoja_nuevos.append([fila["Número"], nombre, fila["Descripción"], fila["Fecha"]])

    hoja_actualizados = libro.create_sheet("Actualizados")
    hoja_actualizados.append([
        "Nombre del Producto",
        "Descripción anterior",
        "Descripción actual",
        "Fecha anterior",
        "Fecha actual",
    ])
    for nombre in nombres_actualizados:
        viejo = anterior[nombre]
        nuevo = actual[nombre]
        hoja_actualizados.append([
            nombre,
            viejo["Descripción"],
            nuevo["Descripción"],
            viejo["Fecha"],
            nuevo["Fecha"],
        ])

    hoja_eliminados = libro.create_sheet("Eliminados")
    hoja_eliminados.append(["Número", "Nombre del Producto", "Descripción", "Fecha"])
    for nombre in nombres_eliminados:
        fila = anterior[nombre]
        hoja_eliminados.append([fila["Número"], nombre, fila["Descripción"], fila["Fecha"]])

    for hoja in libro.worksheets:
        hoja.freeze_panes = "A2"
        for celda in hoja[1]:
            celda.font = Font(bold=True)
        for columna in hoja.columns:
            ancho = max(len(str(celda.value or "")) for celda in columna) + 2
            hoja.column_dimensions[columna[0].column_letter].width = min(ancho, 60)

    libro.save(ruta_excel)
    return len(nombres_nuevos), len(nombres_actualizados), len(nombres_eliminados)

options = webdriver.ChromeOptions()
# options.add_argument('--headless') # Descomenta para ejecutarlo en segundo plano

driver = webdriver.Chrome(service=Service(ChromeDriverManager().install()), options=options)

try:
    # 1. Abrir la URL limpia del catálogo general
    url = "https://datax.com.bo/productos-categoria/?search=&type_view=1"
    driver.get(url)
    print("Catálogo base solicitado.")
    
    wait = WebDriverWait(driver, 20)
    
    # 2. Asegurar la limpieza del buscador (tu lógica original)
    try:
        buscador = wait.until(EC.presence_of_element_located((By.CSS_SELECTOR, "input[type='search'], .search-field, #search")))
        buscador.clear()
        import selenium.webdriver.common.keys as Keys
        buscador.send_keys(Keys.Keys.ENTER)
        time.sleep(3) 
    except Exception as search_err:
        print("Aviso: No se pudo limpiar el buscador, procediendo igual...")

    # ==================== PASO 1: SELECCIONAR TODO ====================
    print("Activando la vista 'TODO'...")
    btn_todo = wait.until(EC.element_to_be_clickable((By.CSS_SELECTOR, ".view-all-btn")))
    driver.execute_script("arguments[0].click();", btn_todo)
    print("Vista 'TODO' activada con éxito.")
    
    time.sleep(12) 

    # ==================== PASO 2: CLIC AUTOMÁTICO EN DATASET ====================
    print("Enviando clic automático a la categoría 'Dataset'...")
    btn_dataset = wait.until(EC.presence_of_element_located((By.CSS_SELECTOR, ".category-Dataset")))
    driver.execute_script("arguments[0].click();", btn_dataset)
    print("-> Filtro aplicado. Esperando los 10 segundos de asentamiento...")
    
    time.sleep(10)
    # ============================================================================

    # 3. Extraer las tarjetas de producto generadas en el DOM
    tarjetas_productos = driver.find_elements(By.CSS_SELECTOR, ".card-product")
    
    print(f"\n¡Extracción completa! Se encontraron {len(tarjetas_productos)} productos finales.")
    print("Guardando datos en archivo CSV...")

    filas_actuales = []
    for idx, tarjeta in enumerate(tarjetas_productos, 1):
        # --- Extracción del Nombre ---
        nombre = tarjeta.get_attribute("data-name")
        if not nombre:
            try:
                nombre = tarjeta.find_element(By.CSS_SELECTOR, ".name-product").text.strip()
            except:
                nombre = "[Nombre no disponible]"

        # --- Extracción de la Descripción ---
        try:
            descripcion = tarjeta.find_element(By.CSS_SELECTOR, ".description-product").text.strip()
            if not descripcion:
                descripcion = "(Sin descripción disponible)"
        except:
            try:
                descripcion = tarjeta.find_element(By.CSS_SELECTOR, ".card-body p").text.strip()
            except:
                descripcion = "[Descripción no localizada]"

        # --- Extracción de la Fecha ---
        try:
            fecha = tarjeta.find_element(By.CSS_SELECTOR, ".keyword-content span").text.strip()
            if not fecha:
                fecha = "(Sin fecha disponible)"
        except:
            try:
                fecha = tarjeta.find_element(By.CSS_SELECTOR, ".keyword-content").text.strip()
            except:
                fecha = "[Fecha no localizada]"

        filas_actuales.append({
            "Número": idx,
            "Nombre del Producto": nombre,
            "Descripción": descripcion,
            "Fecha": fecha,
        })

        if idx % 50 == 0 or idx == len(tarjetas_productos):
            print(f"-> Procesados {idx}/{len(tarjetas_productos)} ítems...")

    HISTORIAL_DIR.mkdir(exist_ok=True)
    marca_tiempo = datetime.now().strftime("%Y%m%d_%H%M%S")
    archivo_snapshot = HISTORIAL_DIR / f"productos_{marca_tiempo}.csv"

    # Se conserva el CSV con el nombre original y también una copia histórica.
    for ruta_csv in (ARCHIVO_CSV, archivo_snapshot):
        with ruta_csv.open(mode="w", newline="", encoding="utf-8-sig") as file:
            writer = csv.writer(file, delimiter=";")
            writer.writerow(["Número", "Nombre del Producto", "Descripción", "Fecha"])
            for fila in filas_actuales:
                writer.writerow([
                    fila["Número"],
                    fila["Nombre del Producto"],
                    fila["Descripción"],
                    fila["Fecha"],
                ])

    snapshots_anteriores = sorted(HISTORIAL_DIR.glob("productos_*.csv"))
    ruta_anterior = snapshots_anteriores[-2] if len(snapshots_anteriores) > 1 else None
    anterior = cargar_snapshot(ruta_anterior) if ruta_anterior else {}
    actual = cargar_snapshot(archivo_snapshot)
    archivo_excel = Path(f"comparacion_productos_{marca_tiempo}.xlsx")
    nuevos, actualizados, eliminados = guardar_comparacion(
        anterior,
        actual,
        ruta_anterior,
        archivo_snapshot,
        archivo_excel,
    )

    print(f"\n¡Éxito total! CSV actual: '{ARCHIVO_CSV}'")
    print(f"Snapshot guardado: '{archivo_snapshot}'")
    print(f"Comparación Excel: '{archivo_excel}'")
    print(
        f"Cambios detectados: {nuevos} nuevos, "
        f"{actualizados} actualizados y {eliminados} eliminados."
    )

except Exception as e:
    print(f"Ocurrió un inconveniente durante el proceso: {e}")

finally:
    driver.quit()