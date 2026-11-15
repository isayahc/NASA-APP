# NASA-APP integration skeleton

This PR adds **real, read-only smoke checks** for the Mapped-Assembly ecosystem and
an embedded OpenCode SDK initialization probe. It does **not** implement lunar
machine control, a physics simulator, the 3D UI, or a live factory.

## Sources and version pins

| Source | Revision or version | What is verified |
| --- | --- | --- |
| [Mapped-Assembly/OpenIndustries](https://github.com/Mapped-Assembly/OpenIndustries) | `838ea330296148621f7a23f7cb647b11e73b5184` | Running local field-lab simulation service, health, domain pin, command/snapshot schema discovery |
| [Mapped-Assembly/OpenForma](https://github.com/Mapped-Assembly/OpenForma) | `718d955c42bb31fd30b512c3a9f08c68f25c02e5` | Real domain registry and ChemicalIR/ProcessIR schema discovery without LLM |
| [Mapped-Assembly/OpenCAD](https://github.com/Mapped-Assembly/OpenCAD) | `9c0c6dc0b5794debdfb8c7507078bae3303dd8bd` | Real headless parametric `Part.box` operation and numeric bounding box |
| [OpenCode SDK](https://opencode.ai/docs/build/sdk) | `@opencode/sdk@2.3.0` | Embedded host lifecycle, server info, sessions and event API presence without provider tokens |

The OI *field-lab* service is used **only to verify transport and the generic
simulation contract**. NASA-APP will need its own lunar foundry domain and a
separate live pose/telemetry stream. No field-lab model, machine behavior, data,
or scientific result is reused for lunar oxygen production.

## Run locally

Use Python 3.11+, Node 22.16+, Bun and Git.

Check out the three pinned MA repos under `vendor/` (the CI workflow provides
the exact commands/SHAs), then install:

```bash
python -m pip install -e vendor/openforma -e vendor/opencad/packages/opencad
npm ci --prefix vendor/openindustries
```

Start OI's actual local test service in one terminal:

```bash
OI_FIELD_LAB_PORT=8792 OI_FIELD_LAB_DB=/tmp/nasa-app-smoke.sqlite \
npm --prefix vendor/openindustries run field-lab:server
```

In another terminal:

```bash
python -m unittest discover -s tests -v
python -m scripts.smoke_integrations --oi-url http://127.0.0.1:8792
cd integrations/opencode && bun install && bun run smoke
```

No model key is needed. A successful smoke check means **these contracts work
at these pinned revisions**. It does not prove MRE chemistry, scene motion,
cross-tool generated CAD interoperability, agent autonomy, or runtime resilience.

Next PR: implement a minimal NASA-APP foundry domain/contract that uses the OI
resource ledger and a typed Python solver bridge; then verify a genuine
hopper-to-preheater material transfer with a live scene, instead of making
promises based on an SDK import.
