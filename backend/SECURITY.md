# Seguridad y claves — CrowdBlinks

Este archivo documenta advertencias y acciones relacionadas con keypairs y despliegues.

## Advertencias críticas

- NO ejecutar `anchor keys sync`, `anchor deploy` ni editar `declare_id!()` en `programs/crowd_pass/src/lib.rs` sin autorización explícita del equipo.
- El Program ID canónico en Devnet es: `AAMoMd6pMFKkSwWuvyG6XNUh1wa3UBv4jbmdtQ8nmTb`. Usar otro `program-id` rompe la compatibilidad con datos existentes.
- En ocasiones hay keypairs legacy generadas durante builds locales en `target/deploy/` (por ejemplo `crowd_pass-keypair.json`). Esas claves pueden derivar un `pubkey` distinto —
  **NUNCA** deben usarse ni distribuirse.

## Pasos recomendados si encuentras keypairs en el repo

1. No las uses. Comunica inmediatamente al equipo responsable.
2. Elimina los archivos de keypair del repositorio con `git rm --cached <ruta>` y añade entradas si falta en `.gitignore`.
3. Si es necesario, reemplace la clave de upgrade-authority siguiendo el flujo consensuado y usando la `upgrade-authority` aprobada por el equipo.

## Flujo seguro para desplegar a Devnet (solo con permiso)

1. Compilar: `anchor build`
2. Pedir la `upgrade-authority` y coordinar ventana de despliegue.
3. Desplegar con `solana program deploy target/deploy/crowd_pass.so --program-id AAMoMd6pMFKkSwWuvyG6XNUh1wa3UBv4jbmdtQ8nmTb --upgrade-authority <ruta-a-keypair> --url https://api.devnet.solana.com`

## Contacto

Si tienes dudas, contacta al equipo responsable del smart contract antes de hacer cambios.
