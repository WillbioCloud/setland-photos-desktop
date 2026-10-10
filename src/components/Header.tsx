import { UserPlus, LayoutDashboard, Users, Package, ShoppingCart, History, Lock, LogOut, Briefcase, Settings, Sun, Moon, Monitor } from 'lucide-react';
import watermarkLogo from '../assets/watermark_setland.png';
import { useTheme, type ThemeMode } from '@/hooks/useTheme';

const THEME_META: Record<ThemeMode, { icon: typeof Sun; label: string; hint: string }> = {
  light: { icon: Sun, label: 'Claro', hint: 'Operação diurna' },
  dark: { icon: Moon, label: 'Escuro', hint: 'Padrão quiosque' },
  system: { icon: Monitor, label: 'Sistema', hint: 'Segue o SO' },
};

/** Seletor de tema (Claro → Escuro → Sistema) com transição animada de ícones. Visual puro. */
function ThemeSelector() {
  const { theme, cycleTheme } = useTheme();
  const { icon: Icon, label, hint } = THEME_META[theme];
  return (
    <button
      onClick={cycleTheme}
      title={`Tema: ${label} (${hint}) — clique para alternar`}
      aria-label={`Alternar tema. Atual: ${label}`}
      className="relative p-2 xl:p-2.5 rounded-full text-brand-muted hover:text-brand-accent hover:bg-brand-accent/10 transition-lux flex items-center justify-center border border-transparent hover:border-brand-accent/20 overflow-hidden"
    >
      <span key={theme} className="animate-theme-icon flex items-center justify-center">
        <Icon className="h-4 w-4" />
      </span>
    </button>
  );
}

export type UserRole = 'operador' | 'gerente' | 'dono';

interface HeaderProps {
  activeTab: string;
  setActiveTab: (tab: string) => void;
  onAdminClick?: () => void;
  onNewClientClick?: () => void;
  userRole: UserRole;
  onLogout?: () => void;
}

export default function Header({ activeTab, setActiveTab, onAdminClick, onNewClientClick, userRole, onLogout }: HeaderProps) {
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
    <header className="px-4 xl:px-6 py-4 xl:py-5 flex items-center justify-between gap-2 overflow-hidden sticky top-0 z-30">
      {/* Bloco Esquerdo: Logo */}
      <div className="bg-brand-surface dark:bg-white/[0.04] dark:backdrop-blur-xl dark:border dark:border-white/10 dark:lux-top-highlight shadow-sm dark:shadow-none lux-card px-4 xl:px-6 py-2 xl:py-2.5 rounded-full flex items-center gap-2 xl:gap-3 shrink-0 transition-lux">
        <img
          src={watermarkLogo}
          alt="Setland"
          className="h-6 xl:h-7 w-auto object-contain dark:drop-shadow-[0_0_10px_rgba(217,164,92,0.45)]"
        />
        <h1 className="text-lg xl:text-xl font-bold text-brand-ink tracking-tight hidden sm:block">Setland</h1>
      </div>

      {/* Bloco Central: Navegação */}
      <nav className="bg-brand-surface dark:bg-white/[0.04] dark:backdrop-blur-xl dark:border dark:border-white/10 shadow-sm dark:shadow-none lux-card p-1 xl:p-1.5 rounded-full flex items-center justify-center gap-0.5 xl:gap-1 flex-1 min-w-0 transition-lux">
        {menuItems.map((item) => {
          const Icon = item.icon;
          const isActive = activeTab === item.id;
          return (
            <button
              key={item.id}
              onClick={() => setActiveTab(item.id)}
              className={`flex items-center gap-1.5 xl:gap-2 px-3 xl:px-6 py-2 xl:py-2.5 rounded-full font-medium transition-lux
                ${isActive
                  ? 'bg-brand-accent text-brand-accent-fg shadow-sm gold-glow'
                  : 'text-brand-muted hover:text-brand-ink hover:bg-brand-accent/10 dark:hover:bg-white/[0.06]'
                }`}
            >
              <Icon className="h-4 w-4 shrink-0" />
              <span className="text-xs xl:text-sm whitespace-nowrap">{item.label}</span>
            </button>
          );
        })}
      </nav>

      {/* Bloco Direito: Terminal e Acesso Gerencial */}
      <div className="bg-brand-surface dark:bg-white/[0.04] dark:backdrop-blur-xl dark:border dark:border-white/10 shadow-sm dark:shadow-none lux-card px-2 xl:px-3 py-1.5 xl:py-2 rounded-full flex items-center gap-2 xl:gap-4 shrink-0 transition-lux">
        
        {/* Botão rápido para o Caixa abrir um novo atendimento */}
        <button 
          onClick={onNewClientClick}
          className="flex items-center gap-1.5 xl:gap-2 bg-brand-accent/10 hover:bg-brand-accent/20 text-brand-accent px-3 xl:px-4 py-1.5 xl:py-2 rounded-full font-semibold transition-all text-xs xl:text-sm ml-1"
        >
          <UserPlus className="h-4 w-4 shrink-0" />
          <span className="hidden sm:inline whitespace-nowrap">Novo Cliente</span>
        </button>

        <div className="h-6 w-[1px] bg-brand-border-dashed"></div>

        {/* Seletor de tema: Claro / Escuro / Sistema */}
        <ThemeSelector />

        <div className="h-6 w-[1px] bg-brand-border-dashed"></div>

        {/* Indicador de Terminal e Controle de Acesso */}
        <div className="flex items-center gap-2 xl:gap-3 pr-1 xl:pr-2">
          <div className="flex flex-col items-end justify-center h-full pt-1 hidden sm:flex">
             <span className="text-[10px] xl:text-sm font-mono tabular-figures text-brand-muted tracking-tight leading-none mb-0.5">
               Terminal 01
             </span>
             {userRole !== 'operador' && (
               <span className="text-[9px] xl:text-[11px] font-bold text-brand-accent tracking-widest uppercase leading-none">
                 {userRole}
               </span>
             )}
          </div>
          {userRole === 'operador' ? (
            <button 
              onClick={onAdminClick}
              className="p-2 xl:p-2.5 rounded-full text-brand-muted hover:bg-brand-bg hover:text-brand-ink transition-colors flex items-center justify-center border border-transparent"
              title="Acesso Gerencial"
            >
              <Lock className="h-4 w-4" />
            </button>
          ) : (
            <button 
              onClick={onLogout}
              className="p-2 xl:p-2.5 rounded-full text-brand-muted hover:bg-brand-danger/10 hover:text-brand-danger transition-colors flex items-center justify-center border border-transparent"
              title="Sair"
            >
              <LogOut className="h-4 w-4" />
            </button>
          )}
        </div>
      </div>
    </header>
  );
}
