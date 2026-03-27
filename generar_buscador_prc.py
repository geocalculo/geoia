import json
import os

BASE = r"C:\Users\Usuario\Documents\GitHub\geoia\capas"

CARPETAS = [
    "capas_01","capas_02","capas_03","capas_04","capas_05",
    "capas_06","capas_07","capas_08","capas_09","capas_10",
    "capas_11","capas_12","capas_13","capas_14","capas_15",
    "capas_16","capas_RM"
]

resultado = []

for carpeta in CARPETAS:
    ruta = os.path.join(BASE, carpeta, "listado.json")

    if not os.path.exists(ruta):
        continue

    with open(ruta, "r", encoding="utf-8") as f:
        data = json.load(f)

    instrumentos = data.get("instrumentos", [])

    for item in instrumentos:
        if isinstance(item, dict):
            resultado.append({
                "nombre": item.get("nombre"),
                "archivo": item.get("archivo"),
                "bbox": item.get("bbox"),
                "carpeta": carpeta,
                "region": data.get("region"),
                "codigo_region": data.get("codigo_region")
            })

with open(os.path.join(BASE, "buscador_prc.json"), "w", encoding="utf-8") as f:
    json.dump(resultado, f, ensure_ascii=False, indent=2)

print(f"✅ Total registros: {len(resultado)}")