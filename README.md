# CrowdBlinks

Ticketing Web3 de fricción cero para eventos, usando **Solana Actions/Blinks**. Los asistentes compran su boleto directamente dentro de un tuit en X (Twitter), sin salir de la red social ni conectar la wallet en sitios externos.

Proyecto desarrollado dentro del programa **Solana Latam Labs (Solana WayLearn)**.

---

## Stack

| Capa | Tecnología |
|---|---|
| On-chain | Rust + Anchor `1.1.2`, programa `crowd_pass` |
| RPC / Cluster | Solana Devnet (Agave/Solana CLI `3.1.10`) |
| Backend/Frontend | Next.js `14.2.35` (App Router) + TypeScript |
| Solana Action API | `@solana/actions` |
| Wallets | Phantom / Solflare vía Wallet Adapter |
| Infra (planeada) | Supabase (Postgres), Vercel Blob, Helius (RPC) |

## Estructura del repo

```
CrowdBlinks-MVP/
├── backend/                  # Programa Anchor (Rust) + tests
│   ├── programs/crowd_pass/  # Smart contract
│   ├── tests/                # Tests en TypeScript (mocha)
│   └── Anchor.toml
└── frontend/                 # Next.js app + Solana Actions API
    ├── app/
    │   ├── api/actions/event/[id]/   # Endpoint de la Solana Action
    │   └── action-test/              # Cliente de prueba manual
    ├── lib/                  # program.ts, idl.json/idl.ts
    └── .env.example
```

---

## 1. Prerrequisitos

Instalar en este orden. Son versiones fijas elegidas a propósito para este proyecto — no actualizar sin coordinarlo con el equipo, ya tuvimos incidentes de compatibilidad al cambiar versiones.

### Rust
```bash
curl --proto '=https' --tlsv1.2 -sSf https://sh.rustup.rs | sh
source $HOME/.cargo/env
rustc --version
```

### Solana CLI (Agave) 3.1.10
```bash
sh -c "$(curl -sSfL https://release.anza.xyz/v3.1.10/install)"
export PATH="$HOME/.local/share/solana/install/active_release/bin:$PATH"
solana --version   # debe mostrar 3.1.10
```
Agrega el `export PATH` anterior a tu `~/.bashrc` o `~/.zshrc` para que persista entre sesiones.

### Anchor CLI 1.1.2 (vía AVM)
```bash
cargo install --git https://github.com/coral-xyz/anchor avm --locked --force
avm install 1.1.2
avm use 1.1.2
anchor --version   # debe mostrar anchor-cli 1.1.2
```

### Node.js 18+ (recomendado 20 LTS)
```bash
# con nvm
nvm install 20
nvm use 20
node --version
```

### Wallet local de Solana (si no tienes una)
```bash
solana-keygen new
solana config set --url https://api.devnet.solana.com
solana airdrop 2
# Si da HTTP 429 (rate limit), reintentar en unos minutos o usar https://faucet.solana.com
```

### ngrok (solo si vas a probar Blinks reales en X)
Necesario para exponer tu `localhost:3000` vía HTTPS público. Instálalo desde [ngrok.com/download](https://ngrok.com/download) y configura tu authtoken:
```bash
ngrok config add-authtoken <tu_token>
ngrok config check
```

---

## 2. Clonar el repo

```bash
git clone https://github.com/Sergioloeraco/CrowdBlinks-MVP.git
cd CrowdBlinks-MVP
```

---

## 3. Backend (programa Anchor)

```bash
cd backend
npm install
```

**Nota WSL2 / máquinas con poca RAM (~4GB):** `/tmp` suele ser `tmpfs` (en RAM) y se llena durante la compilación. Antes de compilar:
```bash
export TMPDIR=~/tmp && mkdir -p $TMPDIR
export CARGO_BUILD_JOBS=1
```

Compilar el programa:
```bash
anchor build
```

Correr los tests (levanta un validador local automáticamente):
```bash
anchor test
```
> El script `test` de `Anchor.toml` usa `yarn run ts-mocha`. Si no tienes yarn instalado, corre en su lugar:
> ```bash
> npx ts-mocha -p ./tsconfig.json -t 1000000 tests/**/*.ts
> ```
> o instala yarn con `npm install -g yarn`.

**⚠️ Importante — no desplegar a Devnet por accidente:**
`Anchor.toml` tiene `cluster = "localnet"` por default, así que `anchor deploy` a secas apunta a tu validador local, no a Devnet. El Program ID de Devnet ya está fijo, desplegado y en uso — **no correr `anchor deploy`, `anchor keys sync`, ni regenerar `target/deploy/crowd_pass-keypair.json` contra Devnet sin avisar al equipo primero.** Ya tuvimos un incidente de mismatch de keypair por esto.

Si en algún momento se necesita re-desplegar a Devnet, el flujo acordado es:
```bash
anchor build
solana program deploy target/deploy/crowd_pass.so \
  --program-id AAMoMd6pMFKkSwWuvyG6XNUh1wa3UBv4jbmdtQ8nmTb \
  --upgrade-authority <ruta-a-la-keypair-de-upgrade-authority> \
  --url https://api.devnet.solana.com
```

---

## 4. Frontend (Next.js + Solana Actions)

```bash
cd frontend
npm install
cp .env.example .env.local
```

Editar `.env.local` con los valores del equipo (pedirlos por el canal interno, no están en el repo):
```
NEXT_PUBLIC_PROGRAM_ID=AAMoMd6pMFKkSwWuvyG6XNUh1wa3UBv4jbmdtQ8nmTb
NEXT_PUBLIC_RPC_URL=https://api.devnet.solana.com
NEXT_PUBLIC_TREASURY_ADDRESS=5Ef7KDsuTB5XzHPJ3D9aX2R4seobdC5ADJb98brrCEm6
```

**⚠️ No dejar `NEXT_PUBLIC_BASE_URL` ni `NEXT_PUBLIC_APP_URL` apuntando a `localhost:3000`** si vas a probar Blinks reales en X. Bórralas del `.env.local` para que `getBaseUrl()` (en `lib/program.ts`) detecte automáticamente el host público de ngrok, o ponlas explícitamente con tu URL pública si despliegas en Vercel.

Levantar el servidor de desarrollo:
```bash
npm run dev
```
La app corre en `http://localhost:3000`.

---

## 5. Probar Blinks públicamente (ngrok)

Para que X y las wallets puedan resolver el Blink necesitas HTTPS público:
```bash
ngrok http 3000
```
Copia la URL pública que te da (`https://xxxx.ngrok-free.dev`) — **cambia en cada sesión**, no es fija. Úsala para pegar el link del evento en X y probar el flujo completo.

También puedes probar el flujo sin salir de la terminal/navegador usando el cliente de prueba interno:
```
http://localhost:3000/action-test
```

---

## 6. Verificar antes de hacer commit

```bash
# Backend
cd backend && anchor build

# Frontend
cd frontend
npx tsc --noEmit
npm run lint
```

---

## 7. Direcciones y valores clave (Devnet)

| Variable | Valor |
|---|---|
| Program ID | `AAMoMd6pMFKkSwWuvyG6XNUh1wa3UBv4jbmdtQ8nmTb` |
| Treasury | `5Ef7KDsuTB5XzHPJ3D9aX2R4seobdC5ADJb98brrCEm6` |
| RPC | `https://api.devnet.solana.com` |

---

## 8. Estado conocido / deuda técnica

- **Naming legado:** el programa Rust (`backend/programs/crowd_pass`) sigue usando internamente `campaign` / `CampaignState` / `support_campaign`, aunque el frontend ya usa `event` en sus rutas. Es deuda de claridad aceptada, no bloquea funcionalidad — no renombrar sin coordinarlo con el equipo.
- **cNFT minting (Metaplex Bubblegum):** aún no implementado. El boleto se registra on-chain (PDA + pago) pero todavía no se mintea el cNFT.
- **Fuera de alcance del MVP (Fase 2):** pagos fiat, wallets invisibles (Account Abstraction), lógica propia anti-drainer (por ahora se depende de la simulación nativa de Phantom/Solflare).

## 9. Convenciones de equipo

- **Nunca editar `lib/idl.ts` / `lib/idl.json` a mano** — siempre regenerar con `anchor build`, o se desincroniza la deserialización de cuentas.
- **No correr acciones irreversibles contra Devnet** (deploy, upgrade de programa, cambios de treasury) sin confirmarlo antes con el equipo.
- Antes de un PR: correr `anchor build` en backend y `tsc --noEmit` + `lint` en frontend.