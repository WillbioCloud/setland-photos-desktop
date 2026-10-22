import React, { useState } from 'react';
import { 
  UserPlus, 
  LayoutDashboard, 
  Users, 
  Package, 
  ShoppingCart, 
  History, 
  Lock, 
  LogOut, 
  Briefcase, 
  Settings, 
  Sun, 
  Moon, 
  Monitor, 
  Camera, 
  Shield 
} from 'lucide-react';
import watermarkLogo from '../assets/watermark_setland.png';
import { useTheme, type ThemeMode } from '@/hooks/useTheme';
import VersionPopover from './VersionPopover';
import { useAutoUpdater } from '@/hooks/useAutoUpdater';

const THEME_META: Record<ThemeMode, { icon: typeof Sun; label: string; hint: string }> = {
  light: { icon: Sun, label: 'Claro', hint: 'Operação diurna' },
  dark: { icon: Moon, label: 'Escuro', hint: 'Padrão quiosque' },
  system: { icon: Monitor, label: 'Sistema', hint: 'Segue o SO' },
};

/** Seletor de tema (Claro → Escuro → Sistema) com transição animada de ícones. */
export function ThemeSelector() {
  const { theme, cycleTheme } = useTheme();
  const { icon: Icon, label, hint } = THEME_META[theme];
  return (
    <button
      onClick={cycleTheme}
      title={`Tema: ${label} (${hint}) — clique para alternar`}
      aria-label={`Alternar tema. Atual: ${label}`}
      className="app-no-drag relative p-2 rounded-xl text-brand-muted hover:text-brand-accent hover:bg-brand-accent/10 transition-lux flex items-center justify-center border border-border dark:border-white/10 overflow-hidden"
    >
      <span key={theme} className="animate-theme-icon flex items-center justify-center">
        <Icon className="h-4 w-4" />
      </span>
    </button>
  );
}

export type UserRole = 'operador' | 'gerente' | 'dono';

export interface SidebarProps {
  activeTab: string;
  setActiveTab: (tab: string) => void;
  userRole: UserRole;
}

export interface HeaderProps {
  activeTab: string;
  setActiveTab?: (tab: string) => void;
  onAdminClick?: () => void;
  onNewClientClick?: () => void;
  onProfileClick?: () => void;
  userRole: UserRole;
  onLogout?: () => void;
}

/**
 * Sidebar Lateral Esquerda Fixa
 * Ideal para monitores quadrados (4:3 / 5:4) como 1024x768 ou 1280x1024.
 */
export function Sidebar({ activeTab, setActiveTab, userRole }: SidebarProps) {
  const [isPopoverOpen, setIsPopoverOpen] = useState(false);
  const {
    updateStatus,
    progress,
    newVersion,
    checkForUpdates,
    installUpdate
  } = useAutoUpdater();

  const menuItems = [
    { id: 'dashboard', label: 'Dashboard', icon: LayoutDashboard },
    { id: 'clientes', label: 'Clientes', icon: Users },
    { id: 'pacotes', label: 'Pacotes', icon: Package },
    { id: 'pdv', label: 'PDV', icon: ShoppingCart },
    { id: 'historico', label: 'Histórico', icon: History },
  ];

  if (userRole === 'gerente' || userRole === 'dono') {
    menuItems.push({ id: 'equipe', label: 'Equipe', icon: Briefcase });
  }

  if (userRole === 'dono') {
    menuItems.push({ id: 'configuracoes', label: 'Configurações', icon: Settings });
  }

  return (
    <aside className="app-no-drag w-56 xl:w-60 h-full shrink-0 flex flex-col bg-brand-surface dark:bg-[#111318] border-r border-border dark:border-white/10 select-none z-30 transition-colors duration-300">
      
      {/* Topo da Sidebar: Logo + Título + Versão (pt-[38px] para Electron window buttons) */}
      <div className="app-drag-region pt-[38px] px-5 pb-4 border-b border-border dark:border-white/10 shrink-0 relative">
        <div className="app-no-drag flex items-center gap-3">
          <img
            src={watermarkLogo}
            alt="Setland"
            className="h-8 w-auto object-contain dark:drop-shadow-[0_0_12px_rgba(217,164,92,0.45)] shrink-0"
          />
          <div className="flex flex-col min-w-0">
            <div className="flex items-center gap-1.5">
              <h1 className="text-lg font-bold text-brand-ink tracking-tight">Setland</h1>
              <button
                type="button"
                onClick={() => setIsPopoverOpen(prev => !prev)}
                className="relative text-[10px] font-mono font-bold px-2 py-0.5 rounded-full bg-brand-accent/10 hover:bg-brand-accent/20 text-brand-accent border border-brand-accent/20 tracking-tight select-none transition-all flex items-center gap-1.5 cursor-pointer active:scale-95"
                title="Detalhes da versão e atualizações do sistema"
              >
                <span>v{__APP_VERSION__}</span>
                {updateStatus === 'downloading' && (
                  <span className="relative flex h-2 w-2" title="Baixando atualização em segundo plano...">
                    <span className="animate-ping absolute inline-flex h-full w-full rounded-full bg-amber-400 opacity-75"></span>
                    <span className="relative inline-flex rounded-full h-2 w-2 bg-amber-500"></span>
                  </span>
                )}
                {updateStatus === 'downloaded' && (
                  <span className="relative flex h-2 w-2" title="Nova versão pronta para reiniciar!">
                    <span className="animate-ping absolute inline-flex h-full w-full rounded-full bg-emerald-400 opacity-75"></span>
                    <span className="relative inline-flex rounded-full h-2 w-2 bg-emerald-500 shadow-[0_0_8px_#10b981]"></span>
                  </span>
                )}
              </button>
            </div>
          </div>
        </div>

        {/* Popover flutuante com dados da versão */}
        <VersionPopover
          isOpen={isPopoverOpen}
          onClose={() => setIsPopoverOpen(false)}
          updateStatus={updateStatus}
          progress={progress}
          newVersion={newVersion}
          onCheckUpdates={checkForUpdates}
          onInstall={installUpdate}
        />
      </div>

      {/* Navegação Vertical com destaque dourado na aba ativa */}
      <nav className="flex-1 px-3 py-4 space-y-1.5 overflow-y-auto no-scrollbar">
        {menuItems.map((item) => {
          const Icon = item.icon;
          const isActive = activeTab === item.id;
          return (
            <button
              key={item.id}
              onClick={() => setActiveTab(item.id)}
              className={`w-full flex items-center gap-3 px-3.5 py-2.5 rounded-xl font-medium transition-lux text-xs xl:text-sm select-none ${
                isActive
                  ? 'bg-brand-accent text-brand-accent-fg shadow-sm gold-glow font-bold'
                  : 'text-brand-muted hover:text-brand-ink hover:bg-brand-accent/10 dark:hover:bg-white/[0.05]'
              }`}
            >
              <Icon className={`h-4 w-4 shrink-0 ${isActive ? 'text-brand-accent-fg' : 'text-primary'}`} />
              <span className="truncate">{item.label}</span>
            </button>
          );
        })}
      </nav>

      {/* Rodapé da Sidebar: Terminal e Cargo */}
      <div className="p-3 border-t border-border dark:border-white/10 shrink-0">
        <div className="px-3 py-2 rounded-xl bg-secondary/30 dark:bg-white/[0.03] border border-border dark:border-white/5 flex items-center justify-between">
          <div className="flex items-center gap-2">
            <span className="w-2 h-2 rounded-full bg-emerald-500 animate-pulse" />
            <span className="text-xs font-mono text-muted-foreground">Terminal 01</span>
          </div>
          <span className="text-[10px] font-bold uppercase tracking-wider text-primary">
            {userRole}
          </span>
        </div>
      </div>

    </aside>
  );
}

/**
 * Topbar Enxuta Superior
 * Posicionada acima do conteúdo principal, com controles rápidos alinhados à direita.
 */
export default function Header({
  activeTab,
  onAdminClick,
  onNewClientClick,
  onProfileClick,
  userRole,
  onLogout
}: HeaderProps) {
  const tabTitles: Record<string, string> = {
    dashboard: 'Dashboard Geral',
    clientes: 'Gestão de Clientes',
    pacotes: 'Tabela de Pacotes',
    pdv: 'Ponto de Venda (PDV)',
    historico: 'Histórico de Vendas',
    equipe: 'Gestão da Equipe',
    configuracoes: 'Configurações do Sistema'
  };

  const profileLabel = userRole === 'operador' ? 'Fotógrafos' : userRole === 'gerente' ? 'Gerente' : 'Dono';

  return (
    <header className="app-drag-region pt-[38px] pb-3 px-4 xl:px-6 flex items-center justify-between border-b border-border dark:border-white/10 shrink-0 select-none bg-background/80 dark:bg-[#0c0d11]/80 backdrop-blur-md sticky top-0 z-20">
      
      {/* Título ou Breadcrumb da aba ativa */}
      <div className="app-no-drag flex items-center gap-2">
        <h2 className="text-base font-bold text-foreground tracking-tight">
          {tabTitles[activeTab] || 'Setland Fotos'}
        </h2>
      </div>

      {/* Controles Rápidos alinhados à direita */}
      <div className="app-no-drag flex items-center gap-2.5 sm:gap-3">
        
        {/* 1. Botão + Novo Cliente */}
        <button
          onClick={onNewClientClick}
          className="app-no-drag flex items-center gap-2 bg-brand-accent hover:opacity-90 text-brand-accent-fg px-3.5 py-2 rounded-xl font-bold transition-lux text-xs shadow-sm gold-glow active:scale-95"
        >
          <UserPlus className="h-4 w-4 shrink-0" />
          <span className="whitespace-nowrap">+ Novo Cliente</span>
        </button>

        <div className="h-5 w-[1px] bg-border dark:bg-white/10" />

        {/* 2. Seletor de Tema (Claro / Escuro / Sistema) */}
        <ThemeSelector />

        <div className="h-5 w-[1px] bg-border dark:bg-white/10" />

        {/* 3. Novo Botão de Perfil (Fotógrafos / Gerente / Dono) */}
        <button
          onClick={onProfileClick}
          className="app-no-drag flex items-center gap-2 px-3.5 py-2 rounded-xl border border-border dark:border-white/10 bg-secondary/30 dark:bg-white/[0.04] hover:border-primary/40 text-foreground transition-lux text-xs font-semibold shadow-sm active:scale-95"
          title={`Abrir perfil (${profileLabel})`}
        >
          {userRole === 'operador' ? (
            <Camera className="w-4 h-4 text-primary shrink-0" />
          ) : (
            <Shield className="w-4 h-4 text-amber-500 shrink-0" />
          )}
          <span className="whitespace-nowrap">{profileLabel}</span>
        </button>

        {/* 4. Botão rápido de Cadeado / Logout */}
        {userRole === 'operador' ? (
          <button
            onClick={onAdminClick}
            className="app-no-drag p-2 rounded-xl text-muted-foreground hover:text-foreground hover:bg-secondary/40 transition-colors border border-border dark:border-white/10"
            title="Elevar para Acesso Gerencial"
          >
            <Lock className="h-4 w-4" />
          </button>
        ) : (
          <button
            onClick={onLogout}
            className="app-no-drag p-2 rounded-xl text-rose-500 hover:text-rose-600 hover:bg-rose-500/10 transition-colors border border-border dark:border-white/10"
            title="Encerrar Sessão Gerencial"
          >
            <LogOut className="h-4 w-4" />
          </button>
        )}

      </div>
    </header>
  );
}
