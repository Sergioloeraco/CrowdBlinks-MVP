// ================================================================
//  CrowdBlinks — Smart Contract (Backend)
//  Solana Latam Labs Program (WayLearn) — Sprint de Desarrollo
//
//  Ticketing Web3 de fricción cero mediante Solana Blinks.
//  Los organizadores crean eventos on-chain y venden boletos
//  directamente en X (Twitter) vía Solana Actions.
//
//  Validado end-to-end en Solana Playground (Devnet, 5/5 tests):
//  crear evento, comprar boleto con split 99%/1%, sold-out
//  automático, rechazo de compra tras agotado, cierre con rent.
//  Pendiente: mint del cNFT (Metaplex Bubblegum) en support_campaign.
// ================================================================

use anchor_lang::prelude::*;
use anchor_lang::system_program;

declare_id!("GSpEH5FMAmXwXSGVNtn6gjM2zGBbvKJAM8QrpqBrsWGf");

// ── Tesorería de CrowdBlinks (recibe el 1% de fee) ──────────────
// TODO: reemplazar por la wallet real de tesorería antes del piloto.
// Usamos Pubkey::new_from_array en vez del macro pubkey!() porque
// esta versión local de Anchor/solana_program no lo expone en la
// ruta anchor_lang::solana_program::pubkey! (sí existe en Playground,
// pero no aquí — versiones distintas de la crate).
pub const TREASURY_PUBKEY: Pubkey = Pubkey::new_from_array([
    98, 245, 69, 103, 185, 209, 2, 74, 243, 64, 222, 227, 168, 96, 185, 27,
    150, 220, 232, 151, 102, 27, 169, 234, 225, 61, 193, 244, 55, 164, 25, 108,
]); // = 7fHsf7Ggr6RNuxFV7zLTrs6yXMdboLJDtBroHefe1PcP

const FEE_BPS: u64 = 100; // 1% = 100 basis points sobre 10_000

// ================================================================
//  PROGRAMA PRINCIPAL
// ================================================================

#[program]
pub mod crowd_pass {
    use super::*;

    // ─────────────────────────────────────────────────────────────
    //  1. INITIALIZE CAMPAIGN  (CREATE)
    // ─────────────────────────────────────────────────────────────
    pub fn initialize_campaign(
        ctx: Context<InitializeCampaign>,
        event_id: String,
        ticket_price: u64,
        max_tickets: u16,
    ) -> Result<()> {
        require!(!event_id.is_empty(), CrowdBlinksError::InvalidEventId);
        require!(event_id.len() <= 32, CrowdBlinksError::InvalidEventId);
        require!(ticket_price > 0, CrowdBlinksError::InvalidTicketPrice);
        require!(max_tickets > 0, CrowdBlinksError::InvalidMaxTickets);
        require!(
            ticket_price.checked_mul(max_tickets as u64).is_some(),
            CrowdBlinksError::Overflow
        );

        let campaign = &mut ctx.accounts.campaign;
        campaign.authority = ctx.accounts.authority.key();
        campaign.event_id = event_id.clone();
        campaign.ticket_price = ticket_price;
        campaign.max_tickets = max_tickets;
        campaign.tickets_sold = 0;
        campaign.is_active = true;

        msg!(
            "CrowdBlinks OK Evento '{}' creado | Precio: {} lamports | Cupo: {}",
            event_id,
            ticket_price,
            max_tickets
        );
        Ok(())
    }

    // ─────────────────────────────────────────────────────────────
    //  2. SUPPORT CAMPAIGN  (Compra de boleto + split de fee 1%)
    // ─────────────────────────────────────────────────────────────
    pub fn support_campaign(ctx: Context<SupportCampaign>, amount: u64) -> Result<()> {
        let campaign = &mut ctx.accounts.campaign;

        require!(campaign.is_active, CrowdBlinksError::CampaignInactive);
        require!(
            campaign.tickets_sold < campaign.max_tickets,
            CrowdBlinksError::CampaignInactive
        );
        require!(
            amount == campaign.ticket_price,
            CrowdBlinksError::IncorrectPaymentAmount
        );
        require_keys_eq!(
            ctx.accounts.treasury.key(),
            TREASURY_PUBKEY,
            CrowdBlinksError::InvalidTreasury
        );

        // ── Split on-chain: 99% organizador / 1% tesorería ──────
        let fee_amount = amount
            .checked_mul(FEE_BPS)
            .and_then(|v| v.checked_div(10_000))
            .ok_or(CrowdBlinksError::Overflow)?;
        let organizer_amount = amount
            .checked_sub(fee_amount)
            .ok_or(CrowdBlinksError::Overflow)?;

        // Transferencia al organizador (99%)
        let cpi_organizer = CpiContext::new(
            ctx.accounts.system_program.key(),
            system_program::Transfer {
                from: ctx.accounts.supporter.to_account_info(),
                to: ctx.accounts.authority.to_account_info(),
            },
        );
        system_program::transfer(cpi_organizer, organizer_amount)?;

        // Transferencia a la tesorería de CrowdBlinks (1%)
        let cpi_treasury = CpiContext::new(
            ctx.accounts.system_program.key(),
            system_program::Transfer {
                from: ctx.accounts.supporter.to_account_info(),
                to: ctx.accounts.treasury.to_account_info(),
            },
        );
        system_program::transfer(cpi_treasury, fee_amount)?;

        // ── Actualizar contador de boletos vendidos ─────────────
        campaign.tickets_sold = campaign
            .tickets_sold
            .checked_add(1)
            .ok_or(CrowdBlinksError::Overflow)?;

        if campaign.tickets_sold >= campaign.max_tickets {
            campaign.is_active = false;
            msg!("CrowdBlinks OK Evento '{}' agotado (sold out).", campaign.event_id);
        }

        // TODO (sprint actual): tras confirmar el pago, emitir el cNFT
        // del boleto vía CPI a Metaplex Bubblegum (mint_to_collection_v1),
        // usando la wallet del supporter como leaf owner. Requiere definir
        // el Merkle Tree del evento y su tree authority — pendiente de
        // diseño, no incluido en este archivo todavía.

        Ok(())
    }

    // ─────────────────────────────────────────────────────────────
    //  3. CLOSE CAMPAIGN  (Recuperar rent)
    // ─────────────────────────────────────────────────────────────
    pub fn close_campaign(ctx: Context<CloseCampaign>) -> Result<()> {
        msg!(
            "CrowdBlinks OK Evento '{}' cerrado definitivamente.",
            ctx.accounts.campaign.event_id
        );
        Ok(())
    }
}

// ================================================================
//  ESTRUCTURAS DE CUENTAS
// ================================================================

#[derive(Accounts)]
#[instruction(event_id: String)]
pub struct InitializeCampaign<'info> {
    #[account(
        init,
        payer = authority,
        space = CampaignState::SPACE,
        seeds = [b"campaign", authority.key().as_ref(), event_id.as_bytes()],
        bump
    )]
    pub campaign: Account<'info, CampaignState>,
    #[account(mut)]
    pub authority: Signer<'info>,
    pub system_program: Program<'info, System>,
}

#[derive(Accounts)]
pub struct SupportCampaign<'info> {
    #[account(
        mut,
        seeds = [b"campaign", campaign.authority.as_ref(), campaign.event_id.as_bytes()],
        bump,
        has_one = authority
    )]
    pub campaign: Account<'info, CampaignState>,
    #[account(mut)]
    pub supporter: Signer<'info>,
    /// CHECK: validado vía has_one = authority contra campaign.authority
    #[account(mut)]
    pub authority: UncheckedAccount<'info>,
    /// CHECK: validado vía require_keys_eq! contra TREASURY_PUBKEY
    #[account(mut)]
    pub treasury: UncheckedAccount<'info>,
    pub system_program: Program<'info, System>,
}

#[derive(Accounts)]
pub struct CloseCampaign<'info> {
    #[account(
        mut,
        seeds = [b"campaign", campaign.authority.as_ref(), campaign.event_id.as_bytes()],
        bump,
        has_one = authority,
        close = authority
    )]
    pub campaign: Account<'info, CampaignState>,
    #[account(mut)]
    pub authority: Signer<'info>,
}

// ================================================================
//  ESTADO DEL PROGRAMA (PDA)
// ================================================================

#[account]
pub struct CampaignState {
    pub authority: Pubkey,
    pub event_id: String,
    pub ticket_price: u64,
    pub max_tickets: u16,
    pub tickets_sold: u16,
    pub is_active: bool,
}

impl CampaignState {
    pub const SPACE: usize =
          8   // discriminator
        + 32  // authority
        + 36  // event_id (4 prefijo + 32 chars max)
        + 8   // ticket_price
        + 2   // max_tickets (u16)
        + 2   // tickets_sold (u16)
        + 1;  // is_active
}

// ================================================================
//  ERRORES
// ================================================================

#[error_code]
pub enum CrowdBlinksError {
    #[msg("El event_id no puede estar vacío ni superar 32 caracteres.")]
    InvalidEventId,
    #[msg("El precio del boleto debe ser mayor a 0 lamports.")]
    InvalidTicketPrice,
    #[msg("El máximo de boletos debe ser mayor a 0.")]
    InvalidMaxTickets,
    #[msg("Este evento no está activo o ya se agotó.")]
    CampaignInactive,
    #[msg("El monto enviado no coincide con el precio del boleto.")]
    IncorrectPaymentAmount,
    #[msg("La cuenta de tesorería no coincide con la esperada.")]
    InvalidTreasury,
    #[msg("Desbordamiento aritmético detectado.")]
    Overflow,
}