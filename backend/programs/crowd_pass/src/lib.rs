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
//  Pendiente: mint del cNFT (Metaplex Bubblegum) en buy_ticket.
// ================================================================

// ----------------------------------------------------------------
// !!! ADVERTENCIA CRÍTICA !!!
// Antes de modificar este archivo o desplegar el programa:
// - NO ejecutar `anchor keys sync` ni `anchor deploy` sin autorización.
// - NO editar `declare_id!()` en este archivo sin autorización.
// - El Program ID canónico en Devnet es: AAMoMd6pMFKkSwWuvyG6XNUh1wa3UBv4jbmdtQ8nmTb
// - Existen keypairs legacy en `backend/target/deploy/crowd_pass-keypair.json`
//   que derivan una clave pública distinta y NUNCA deben usarse.
// Si necesitas realizar cambios en Devnet, coordina con el equipo y usa
// el flujo de despliegue documentado en README.md.
// ----------------------------------------------------------------

use anchor_lang::prelude::*;
use anchor_lang::system_program;

declare_id!("CWvXjxVGPp4r42avcvZRF5yuaqPSNL7FkJpgdmnvuGJq");

pub const TREASURY_PUBKEY: Pubkey =
    pubkey!("5Ef7KDsuTB5XzHPJ3D9aX2R4seobdC5ADJb98brrCEm6");

const MAX_EVENT_ID_LEN: usize = 32;
const FEE_BPS: u64 = 100;
const BPS_DENOMINATOR: u64 = 10_000;

#[program]
pub mod crowd_pass {
    use super::*;

    pub fn initialize_event(
        ctx: Context<InitializeEvent>,
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

        let event = &mut ctx.accounts.event;
        event.authority = ctx.accounts.authority.key();
        event.event_id = event_id.clone();
        event.ticket_price = ticket_price;
        event.max_tickets = max_tickets;
        event.tickets_sold = 0;
        event.is_active = true;

        msg!(
            "CrowdBlinks event '{}' created | price: {} lamports | capacity: {}",
            event_id,
            ticket_price,
            max_tickets
        );
        Ok(())
    }

    pub fn buy_ticket(ctx: Context<BuyTicket>, amount: u64) -> Result<()> {
        let event = &mut ctx.accounts.event;

        require!(event.is_active, CrowdBlinksError::EventInactive);
        require!(
            event.tickets_sold < event.max_tickets,
            CrowdBlinksError::EventInactive
        );
        require!(
            amount == event.ticket_price,
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

        let cpi_program = ctx.accounts.system_program.to_account_info();
        let cpi_organizer_accounts = system_program::Transfer {
            from: ctx.accounts.buyer.to_account_info(),
            to: ctx.accounts.authority.to_account_info(),
        };
        let cpi_organizer = CpiContext::new(cpi_program.key(), cpi_organizer_accounts);
        system_program::transfer(cpi_organizer, organizer_amount)?;

        let cpi_treasury_accounts = system_program::Transfer {
            from: ctx.accounts.buyer.to_account_info(),
            to: ctx.accounts.treasury.to_account_info(),
        };
        let cpi_treasury = CpiContext::new(cpi_program.key(), cpi_treasury_accounts);
        system_program::transfer(cpi_treasury, fee_amount)?;

        event.tickets_sold = event
            .tickets_sold
            .checked_add(1)
            .ok_or(CrowdBlinksError::Overflow)?;

        if event.tickets_sold >= event.max_tickets {
            event.is_active = false;
            msg!("CrowdBlinks event '{}' sold out.", event.event_id);
        }

        Ok(())
    }

    pub fn close_event(ctx: Context<CloseEvent>) -> Result<()> {
        msg!(
            "CrowdBlinks event '{}' closed.",
            ctx.accounts.event.event_id
        );
        Ok(())
    }
}

#[derive(Accounts)]
#[instruction(event_id: String)]
pub struct InitializeEvent<'info> {
    #[account(
        init,
        payer = authority,
        space = EventState::SPACE,
        seeds = [b"event", authority.key().as_ref(), event_id.as_bytes()],
        bump
    )]
    pub event: Box<Account<'info, EventState>>,
    #[account(mut)]
    pub authority: Signer<'info>,
    pub system_program: Program<'info, System>,
}

#[derive(Accounts)]
pub struct BuyTicket<'info> {
    #[account(
        mut,
        seeds = [b"event", event.authority.as_ref(), event.event_id.as_bytes()],
        bump,
        has_one = authority
    )]
    pub event: Box<Account<'info, EventState>>,
    #[account(mut)]
    pub buyer: Signer<'info>,
    /// CHECK: validated by has_one against event.authority.
    #[account(mut)]
    pub authority: UncheckedAccount<'info>,
    /// CHECK: validated against TREASURY_PUBKEY.
    #[account(mut)]
    pub treasury: UncheckedAccount<'info>,
    pub system_program: Program<'info, System>,
}

#[derive(Accounts)]
pub struct CloseEvent<'info> {
    #[account(
        mut,
        seeds = [b"event", event.authority.as_ref(), event.event_id.as_bytes()],
        bump,
        has_one = authority,
        close = authority
    )]
    pub event: Box<Account<'info, EventState>>,
    #[account(mut)]
    pub authority: Signer<'info>,
}

#[account]
pub struct EventState {
    pub authority: Pubkey,
    pub event_id: String,
    pub ticket_price: u64,
    pub max_tickets: u16,
    pub tickets_sold: u16,
    pub is_active: bool,
}

impl EventState {
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
    #[msg("Este evento no esta activo.")]
    EventInactive,
    #[msg("El evento ya está agotado (sold out).")]
    SoldOut,
    #[msg("El monto enviado no coincide con el precio del boleto.")]
    IncorrectPaymentAmount,
    #[msg("La cuenta de tesoreria no coincide con la esperada.")]
    InvalidTreasury,
    #[msg("Desbordamiento aritmetico detectado.")]
    Overflow,
}