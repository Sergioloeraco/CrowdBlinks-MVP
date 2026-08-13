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

declare_id!("AAMoMd6pMFKkSwWuvyG6XNUh1wa3UBv4jbmdtQ8nmTb");

pub const TREASURY_PUBKEY: Pubkey =
    pubkey!("5Ef7KDsuTB5XzHPJ3D9aX2R4seobdC5ADJb98brrCEm6");

const MAX_EVENT_ID_LEN: usize = 32;
const FEE_BPS: u64 = 100;
const BPS_DENOMINATOR: u64 = 10_000;

#[program]
pub mod crowd_pass {
    use super::*;

    pub fn initialize_campaign(
        ctx: Context<InitializeCampaign>,
        event_id: String,
        ticket_price: u64,
        max_tickets: u16,
    ) -> Result<()> {
        require!(!event_id.is_empty(), CrowdBlinksError::InvalidEventId);
        require!(
            event_id.len() <= MAX_EVENT_ID_LEN,
            CrowdBlinksError::InvalidEventId
        );
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
            "CrowdBlinks event '{}' created | price: {} lamports | capacity: {}",
            event_id,
            ticket_price,
            max_tickets
        );
        Ok(())
    }

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

        let fee_amount = amount
            .checked_mul(FEE_BPS)
            .and_then(|value| value.checked_div(BPS_DENOMINATOR))
            .ok_or(CrowdBlinksError::Overflow)?;
        let organizer_amount = amount
            .checked_sub(fee_amount)
            .ok_or(CrowdBlinksError::Overflow)?;

        let cpi_organizer = CpiContext::new(
            ctx.accounts.system_program.key(),
            system_program::Transfer {
                from: ctx.accounts.supporter.to_account_info(),
                to: ctx.accounts.authority.to_account_info(),
            },
        );
        system_program::transfer(cpi_organizer, organizer_amount)?;

        let cpi_treasury = CpiContext::new(
            ctx.accounts.system_program.key(),
            system_program::Transfer {
                from: ctx.accounts.supporter.to_account_info(),
                to: ctx.accounts.treasury.to_account_info(),
            },
        );
        system_program::transfer(cpi_treasury, fee_amount)?;

        campaign.tickets_sold = campaign
            .tickets_sold
            .checked_add(1)
            .ok_or(CrowdBlinksError::Overflow)?;

        if campaign.tickets_sold >= campaign.max_tickets {
            campaign.is_active = false;
            msg!("CrowdBlinks event '{}' sold out.", campaign.event_id);
        }

        Ok(())
    }

    pub fn close_campaign(ctx: Context<CloseCampaign>) -> Result<()> {
        msg!(
            "CrowdBlinks event '{}' closed.",
            ctx.accounts.campaign.event_id
        );
        Ok(())
    }
}

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
    pub campaign: Box<Account<'info, CampaignState>>,
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
    pub campaign: Box<Account<'info, CampaignState>>,
    #[account(mut)]
    pub supporter: Signer<'info>,
    /// CHECK: validated by has_one against campaign.authority.
    #[account(mut)]
    pub authority: UncheckedAccount<'info>,
    /// CHECK: validated against TREASURY_PUBKEY.
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
    pub campaign: Box<Account<'info, CampaignState>>,
    #[account(mut)]
    pub authority: Signer<'info>,
}

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
    pub const SPACE: usize = 8 + 32 + (4 + MAX_EVENT_ID_LEN) + 8 + 2 + 2 + 1;
}

#[error_code]
pub enum CrowdBlinksError {
    #[msg("El event_id no puede estar vacio ni superar 32 caracteres.")]
    InvalidEventId,
    #[msg("El precio del boleto debe ser mayor a 0 lamports.")]
    InvalidTicketPrice,
    #[msg("El maximo de boletos debe ser mayor a 0.")]
    InvalidMaxTickets,
    #[msg("Este evento no esta activo o ya se agoto.")]
    CampaignInactive,
    #[msg("El monto enviado no coincide con el precio del boleto.")]
    IncorrectPaymentAmount,
    #[msg("La cuenta de tesoreria no coincide con la esperada.")]
    InvalidTreasury,
    #[msg("Desbordamiento aritmetico detectado.")]
    Overflow,
}
