"""Verificación del parser/validador del bloque ```plan (M1).

No es pytest: es un script autocontenido con datos sintéticos que ejercita
``tripsuggest.plan.parse_plan_block`` y falla con exit != 0 ante cualquier
assertion rota.

Ejecutar desde ``local/agent-service``:

    uv run python scripts/verify_plan.py
"""

from __future__ import annotations

import sys

sys.path.insert(0, "src")

from tripsuggest.plan import parse_plan_block

PASS = 0
FAIL = 0


def check(name: str, actual: object, expected: object) -> None:
    global PASS, FAIL
    if actual == expected:
        PASS += 1
        print(f"  ok   {name}")
    else:
        FAIL += 1
        print(f"  FAIL {name}\n        esperado: {expected!r}\n        obtenido:  {actual!r}")


def main() -> int:
    print("1) parseo OK")
    answer = (
        "Un día en Panamá: desayuno, Casco Viejo y cena.\n"
        "```plan\n"
        '[{"placeId": "p-1", "title": "Café de la Plaza", "category": "food", "cost": 12, "startTime": "08:30"},\n'
        ' {"placeId": "p-2", "title": "Casco Viejo tour", "category": "activity", "cost": 30, "startTime": "10:00"}]\n'
        "```"
    )
    plan = parse_plan_block(answer)
    check("2 entradas", len(plan), 2)
    check("placeId", plan[0]["placeId"], "p-1")
    check("title", plan[0]["title"], "Café de la Plaza")
    check("category", plan[0]["category"], "food")
    check("cost numérico", plan[0]["cost"], 12.0)
    check("startTime", plan[0]["startTime"], "08:30")

    print("2) bloque ausente → plan []")
    check("sin bloque", parse_plan_block("Texto sin bloque de plan."), [])

    print("3) hora inválida → null")
    answer = (
        "```plan\n"
        '[{"placeId": "p-1", "title": "Lugar", "category": "food", "cost": 10, "startTime": "25:00"}]\n'
        "```"
    )
    plan = parse_plan_block(answer)
    check("entrada se conserva", len(plan), 1)
    check("startTime null", plan[0]["startTime"], None)

    print("4) hora fuera de 07:00-23:00 → null")
    answer = (
        "```plan\n"
        '[{"placeId": "p-1", "title": "Lugar", "category": "food", "cost": 10, "startTime": "06:59"}]\n'
        "```"
    )
    plan = parse_plan_block(answer)
    check("startTime null (06:59)", plan[0]["startTime"], None)

    print("5) entradas sin placeId/title se filtran")
    answer = (
        "```plan\n"
        '[{"title": "Sin id", "category": "food", "cost": 5, "startTime": "09:00"},\n'
        ' {"placeId": "p-1", "category": "food", "cost": 5, "startTime": "09:00"},\n'
        ' {"placeId": "p-2", "title": "Ok", "category": "food", "cost": 5, "startTime": "09:00"}]\n'
        "```"
    )
    plan = parse_plan_block(answer)
    check("solo queda la entrada válida", len(plan), 1)
    check("placeId correcto", plan[0]["placeId"], "p-2")

    print("6) bloque malformado / JSON inválido → plan []")
    answer = "```plan\n[esto no es json válido]\n```"
    check("JSON inválido", parse_plan_block(answer), [])

    print("7) hora límite válida")
    answer = (
        "```plan\n"
        '[{"placeId": "p-1", "title": "Lugar", "category": "activity", "cost": null, "startTime": "23:00"}]\n'
        "```"
    )
    plan = parse_plan_block(answer)
    check("23:00 válida", plan[0]["startTime"], "23:00")
    check("cost null", plan[0]["cost"], None)

    print(f"\nResultado: {PASS} ok, {FAIL} fallos")
    return 1 if FAIL else 0


if __name__ == "__main__":
    raise SystemExit(main())
