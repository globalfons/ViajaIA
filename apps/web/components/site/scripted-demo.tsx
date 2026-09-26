"use client";

import { useState } from "react";

type Step = { from: "cliente" | "agente" | "equipo"; text: string; behind: string };

/** Predefined example conversations. Clearly labelled: this is NOT AI answering live. */
const SCENARIOS: { key: string; label: string; steps: Step[] }[] = [
  {
    key: "soporte",
    label: "Atención al cliente",
    steps: [
      { from: "cliente", text: "Hola, ¿abrís el sábado por la mañana?", behind: "Llega un mensaje desde el chat web del negocio." },
      { from: "agente", text: "Sí, los sábados abrimos de 10:00 a 14:00. Entre semana, de 9:00 a 20:00 [1].", behind: "Busca en la documentación del negocio y cita la fuente [1] (horario.pdf). Confianza alta: responde." },
      { from: "cliente", text: "Quiero reclamar un cobro que no reconozco.", behind: "Detecta una reclamación de facturación." },
      { from: "agente", text: "Entiendo. He pasado tu consulta a una persona del equipo, que te responderá en breve.", behind: "Las reclamaciones requieren a una persona: la conversación pasa a «escalada» en la bandeja del equipo." },
      { from: "equipo", text: "Hola, soy Laura. Revisamos el cargo ahora mismo; ¿me confirmas los 4 últimos dígitos de la tarjeta?", behind: "Una persona continúa la conversación. La IA deja de responder en este hilo." },
    ],
  },
  {
    key: "ventas",
    label: "Ventas",
    steps: [
      { from: "cliente", text: "Somos 12 en la oficina y queremos un curso de inglés. ¿Qué opciones tenéis?", behind: "Un interesado escribe por primera vez (contacto iniciado por él)." },
      { from: "agente", text: "Tenemos formación in-company en grupos de hasta 12 personas [1]. ¿Para cuándo os gustaría empezar y qué nivel tiene el grupo?", behind: "Responde con el catálogo y pregunta lo necesario para cualificar (BANT: necesidad y plazo)." },
      { from: "cliente", text: "Para octubre, nivel intermedio. Tenemos presupuesto aprobado.", behind: "Obtiene plazo, nivel y presupuesto." },
      { from: "agente", text: "Perfecto. Un asesor te llamará para preparar la propuesta. ¿Te va bien mañana por la mañana?", behind: "Registra el lead en el CRM con puntuación 80 («cualificado») y crea una tarea para el comercial." },
    ],
  },
  {
    key: "citas",
    label: "Citas",
    steps: [
      { from: "cliente", text: "¿Tenéis hueco para una revisión esta semana?", behind: "Petición de cita por WhatsApp." },
      { from: "agente", text: "Tengo estos huecos: jueves 10:00, jueves 12:30 o viernes 9:30. ¿Cuál prefieres?", behind: "Consulta la disponibilidad real en el calendario del centro, dentro de su horario." },
      { from: "cliente", text: "Jueves a las 10, soy Ana.", behind: "El cliente confirma día, hora y nombre." },
      { from: "agente", text: "Listo, Ana: revisión reservada el jueves a las 10:00.", behind: "Vuelve a comprobar el hueco y crea el evento en el calendario (sin enviar invitaciones)." },
    ],
  },
];

export function ScriptedDemo() {
  const [scenario, setScenario] = useState(SCENARIOS[0]!.key);
  const [shown, setShown] = useState(1);
  const sc = SCENARIOS.find((s) => s.key === scenario)!;
  const visible = sc.steps.slice(0, shown);
  const done = shown >= sc.steps.length;
  return (
    <div className="space-y-5">
      <p role="note" className="rounded-2xl border border-amber-400/40 bg-amber-400/10 px-4 py-3 text-sm font-medium text-amber-200">
        MODO DEMO · Conversación de ejemplo predefinida. No es una IA respondiendo en tiempo real.
      </p>
      <div className="flex flex-wrap gap-2" role="tablist" aria-label="Escenarios de demo">
        {SCENARIOS.map((s) => (
          <button
            key={s.key}
            role="tab"
            aria-selected={s.key === scenario}
            onClick={() => {
              setScenario(s.key);
              setShown(1);
            }}
            className={`rounded-full px-4 py-2 text-sm transition ${s.key === scenario ? "bg-white text-slate-900" : "border border-white/15 text-slate-200 hover:bg-white/5"}`}
          >
            {s.label}
          </button>
        ))}
      </div>
      <div className="grid gap-5 lg:grid-cols-[1.3fr_1fr]">
        <div className="min-h-80 space-y-3 rounded-2xl border border-white/10 bg-[#0B1020] p-4 sm:p-6" aria-live="polite">
          {visible.map((m, i) => (
            <div key={i} className={`flex ${m.from === "cliente" ? "justify-start" : "justify-end"}`}>
              <div className={`max-w-[85%] rounded-2xl px-4 py-2.5 text-sm ${m.from === "cliente" ? "bg-white/10 text-slate-100" : m.from === "equipo" ? "border border-cyan-300/30 bg-cyan-400/10 text-cyan-50" : "bg-gradient-to-r from-violet-600/80 to-cyan-600/70 text-white"}`}>
                <p className="mb-0.5 text-[10px] uppercase tracking-wider opacity-70">{m.from === "cliente" ? "Cliente" : m.from === "equipo" ? "Equipo (persona)" : "Agente IA · ejemplo"}</p>
                {m.text}
              </div>
            </div>
          ))}
        </div>
        <div className="space-y-3">
          <div className="rounded-2xl border border-white/10 bg-white/[0.03] p-4">
            <p className="text-xs font-semibold uppercase tracking-[0.18em] text-cyan-300">Qué pasa por detrás</p>
            <p className="mt-2 text-sm text-slate-300">{visible[visible.length - 1]!.behind}</p>
          </div>
          <div className="flex gap-2">
            <button onClick={() => setShown((n) => Math.min(n + 1, sc.steps.length))} disabled={done} className="h-11 flex-1 rounded-full bg-gradient-to-r from-violet-500 to-cyan-500 text-sm font-semibold text-white disabled:opacity-40">
              {done ? "Fin del ejemplo" : "Siguiente mensaje"}
            </button>
            <button onClick={() => setShown(1)} className="h-11 rounded-full border border-white/15 px-5 text-sm text-white hover:bg-white/5">
              Reiniciar
            </button>
          </div>
        </div>
      </div>
    </div>
  );
}
