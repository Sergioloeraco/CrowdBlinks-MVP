use anchor_lang::prelude::*;
use anchor_lang::system_program;

// Este ID se actualizará automáticamente cuando le des a "Build" en Playground
declare_id!("4RfgHgQRwssnJuzShFwmZVEw7DjNJj5TFPLjFJWJ8MT1");

#[program]
pub mod crowd_pass {
    use super::*;

    // 1. CREAR LA CAMPAÑA (Evolución de create_payment)
    pub fn initialize_campaign(
        ctx: Context<InitializeCampaign>,
        event_id: String,
        ticket_price: u64,
        funding_goal: u64,
        max_tickets: u16,
    ) -> Result<()> {
        require!(funding_goal > 0, CrowdPassError::InvalidGoal);
        
        let campaign = &mut ctx.accounts.campaign;
        campaign.authority = ctx.accounts.authority.key();
        campaign.event_id = event_id;
        campaign.ticket_price = ticket_price; // Si es 0, es donación libre
        campaign.funding_goal = funding_goal;
        campaign.current_funding = 0;
        campaign.max_tickets = max_tickets;
        campaign.tickets_sold = 0;
        campaign.is_active = true;

        msg!("Campaña {} creada. Meta: {}", campaign.event_id, campaign.funding_goal);
        Ok(())
    }

    // 2. COMPRAR BOLETO O DONAR (Evolución de pay - Ahora con Escrow)
    pub fn support_campaign(ctx: Context<SupportCampaign>, _event_id: String, amount: u64) -> Result<()> {
        let campaign = &mut ctx.accounts.campaign;
        
        require!(campaign.is_active, CrowdPassError::CampaignInactive);
        require!(amount > 0, CrowdPassError::AmountMustBePositive);

        // Lógica de Boletos
        if campaign.ticket_price > 0 {
            require!(amount == campaign.ticket_price, CrowdPassError::IncorrectPaymentAmount);
            require!(campaign.tickets_sold < campaign.max_tickets, CrowdPassError::SoldOut);
            
            campaign.tickets_sold = campaign.tickets_sold.checked_add(1).unwrap();

            // Auto-desactivar si llegamos al Sold Out
            if campaign.tickets_sold == campaign.max_tickets {
                campaign.is_active = false; 
            }
        }

        // TRANSFERENCIA AL ESCROW: El dinero va al PDA, no a la wallet del organizador
        let cpi_context = CpiContext::new(
            ctx.accounts.system_program.to_account_info(),
            system_program::Transfer {
                from: ctx.accounts.supporter.to_account_info(),
                to: campaign.to_account_info(), // <--- ¡La magia del Escrow está aquí!
            }
        );
        system_program::transfer(cpi_context, amount)?;

        campaign.current_funding = campaign.current_funding.checked_add(amount).unwrap();

        msg!("Apoyo recibido: {} lamports", amount);
        Ok(())
    }

    // 3. RETIRAR FONDOS (¡NUEVO! Solo el organizador puede sacar el dinero del Escrow)
    pub fn withdraw_funds(ctx: Context<WithdrawFunds>, _event_id: String) -> Result<()> {
        let campaign = &mut ctx.accounts.campaign;
        let authority = &mut ctx.accounts.authority;

        let rent_minimum = Rent::get()?.minimum_balance(campaign.to_account_info().data_len());
        let available_funds = campaign.to_account_info().lamports().checked_sub(rent_minimum).unwrap_or(0);

        require!(available_funds > 0, CrowdPassError::NoFundsToWithdraw);

        // Transferimos internamente del PDA a la wallet del organizador
        **campaign.to_account_info().try_borrow_mut_lamports()? -= available_funds;
        **authority.to_account_info().try_borrow_mut_lamports()? += available_funds;

        msg!("Fondos retirados exitosamente");
        Ok(())
    }

    // 4. ELIMINAR CAMPAÑA (Evolución de delete_payment)
    pub fn close_campaign(_ctx: Context<CloseCampaign>, _event_id: String) -> Result<()> {
        msg!("Campaña cerrada y Rent recuperado");
        Ok(())
    }
}

// ----------------------------------------------------
// DEFINICIÓN DE LAS CUENTAS (Las "Tablas")
// ----------------------------------------------------

#[derive(Accounts)]
#[instruction(event_id: String)]
pub struct InitializeCampaign<'info> {
    #[account(
        init,
        payer = authority,
        space = 8 + 32 + (4 + 50) + 8 + 8 + 8 + 2 + 2 + 1, 
        seeds = [b"campaign", authority.key().as_ref(), event_id.as_bytes()],
        bump
    )]
    pub campaign: Account<'info, CampaignState>,
    #[account(mut)]
    pub authority: Signer<'info>,
    pub system_program: Program<'info, System>,
}

#[derive(Accounts)]
#[instruction(event_id: String)]
pub struct SupportCampaign<'info> {
    #[account(
        mut,
        seeds = [b"campaign", campaign.authority.key().as_ref(), event_id.as_bytes()],
        bump
    )]
    pub campaign: Account<'info, CampaignState>,
    #[account(mut)]
    pub supporter: Signer<'info>, 
    pub system_program: Program<'info, System>,
}

#[derive(Accounts)]
#[instruction(event_id: String)]
pub struct WithdrawFunds<'info> {
    #[account(
        mut,
        seeds = [b"campaign", authority.key().as_ref(), event_id.as_bytes()],
        bump,
        has_one = authority // Seguridad: Solo el dueño retira
    )]
    pub campaign: Account<'info, CampaignState>,
    #[account(mut)]
    pub authority: Signer<'info>,
}

#[derive(Accounts)]
#[instruction(event_id: String)]
pub struct CloseCampaign<'info> {
    #[account(
        mut,
        seeds = [b"campaign", authority.key().as_ref(), event_id.as_bytes()],
        bump,
        close = authority, 
        has_one = authority 
    )]
    pub campaign: Account<'info, CampaignState>,
    #[account(mut)]
    pub authority: Signer<'info>,
}

// ----------------------------------------------------
// ESTRUCTURA DE ESTADO (El "Esquema")
// ----------------------------------------------------

#[account]
pub struct CampaignState {
    pub authority: Pubkey,       
    pub event_id: String,        
    pub ticket_price: u64,       
    pub funding_goal: u64,       
    pub current_funding: u64,    
    pub max_tickets: u16,        
    pub tickets_sold: u16,       
    pub is_active: bool,         
}

// ----------------------------------------------------
// MANEJO DE ERRORES
// ----------------------------------------------------

#[error_code]
pub enum CrowdPassError {
    #[msg("La meta de recaudacion debe ser mayor a 0.")]
    InvalidGoal,
    #[msg("La campana ya no esta activa o hizo Sold Out.")]
    CampaignInactive,
    #[msg("El monto de aportacion debe ser mayor a 0.")]
    AmountMustBePositive,
    #[msg("El monto de pago no coincide con el precio del boleto.")]
    IncorrectPaymentAmount,
    #[msg("Los boletos se han agotado (Sold Out).")]
    SoldOut,
    #[msg("No hay fondos disponibles para retirar.")]
    NoFundsToWithdraw,
}