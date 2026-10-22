import React, { useState, useEffect } from 'react';
import { Card, CardHeader, CardTitle, CardContent, CardDescription } from '@/components/ui/card';
import { Save, HardDrive, Receipt, Image as ImageIcon, Ban, MessageCircle, QrCode, RefreshCw, Wifi, WifiOff, CheckCircle2, Loader2, LogOut } from 'lucide-react';
import { Input } from '@/components/ui/input';
import { toast } from "sonner";
import { supabase } from '@/lib/supabaseClient';

export type UserRole = 'operador' | 'gerente' | 'dono';

interface SettingsProps {
  userRole: UserRole;
}

export default function Settings({ userRole }: SettingsProps) {
  const [driveId, setDriveId] = useState('');
  const [receiptFooter, setReceiptFooter] = useState('');
  const [waApiUrl, setWaApiUrl] = useState('');
  const [waInstance, setWaInstance] = useState('');
  const [isLoading, setIsLoading] = useState(false);

  // Estados da Conexão Evolution API / WhatsApp
  const [connectionStatus, setConnectionStatus] = useState<'open' | 'close' | 'connecting' | 'unknown'>('unknown');
  const [qrCodeBase64, setQrCodeBase64] = useState<string | null>(null);
  const [isCheckingStatus, setIsCheckingStatus] = useState(false);
  const [isGeneratingQr, setIsGeneratingQr] = useState(false);

  const EVO_BASE_URL = 'http://evolution-api.elevatiovendas.com.br';
  const EVO_API_KEY = 'ElevatioKey2026';

  // 1. Checa o estado da conexão na Evolution API
  const checkStatus = async (instanceName?: string) => {
    const inst = (instanceName || waInstance).trim();
    if (!inst) return;

    setIsCheckingStatus(true);
    try {
      const response = await fetch(`${EVO_BASE_URL}/instance/connectionState/${inst}`, {
        method: 'GET',
        headers: { 'apikey': EVO_API_KEY }
      });

      if (!response.ok) {
        setConnectionStatus('close');
        return;
      }

      const resData = await response.json();
      const state = resData?.instance?.state || resData?.state || 'close';

      setConnectionStatus(state === 'open' ? 'open' : 'close');

      if (state === 'open') {
        setQrCodeBase64(null);
      }
    } catch (err) {
      console.warn('[WhatsApp] Falha ao consultar status da instância:', err);
      setConnectionStatus('close');
    } finally {
      setIsCheckingStatus(false);
    }
  };

  // 2. Solicita o QR Code para pareamento
  const handleGenerateQr = async () => {
    const inst = waInstance.trim();
    if (!inst) {
      toast.error('Informe o Nome da Instância antes de gerar o QR Code.');
      return;
    }

    setIsGeneratingQr(true);
    const toastId = toast.loading('Gerando QR Code de pareamento...');

    try {
      const response = await fetch(`${EVO_BASE_URL}/instance/connect/${inst}`, {
        method: 'GET',
        headers: { 'apikey': EVO_API_KEY }
      });

      const resData = await response.json();
      const rawBase64 = resData?.base64 || resData?.qrcode?.base64;

      if (!rawBase64) {
        if (resData?.instance?.state === 'open' || resData?.state === 'open') {
          setConnectionStatus('open');
          setQrCodeBase64(null);
          toast.success('Esta instância já está conectada ao WhatsApp!', { id: toastId });
          return;
        }
        throw new Error('Não foi possível obter o QR Code da Evolution API.');
      }

      const formatted = rawBase64.startsWith('data:') ? rawBase64 : `data:image/png;base64,${rawBase64}`;
      setQrCodeBase64(formatted);
      setConnectionStatus('connecting');
      toast.success('QR Code gerado! Aponte a câmera do WhatsApp.', { id: toastId });
    } catch (err: any) {
      console.error(err);
      toast.error(err?.message || 'Erro ao conectar à instância do WhatsApp.', { id: toastId });
    } finally {
      setIsGeneratingQr(false);
    }
  };

  // 3. Desconectar WhatsApp
  const handleDisconnect = async () => {
    const inst = waInstance.trim();
    if (!inst) return;

    const toastId = toast.loading('Desconectando WhatsApp...');
    try {
      await fetch(`${EVO_BASE_URL}/instance/logout/${inst}`, {
        method: 'DELETE',
        headers: { 'apikey': EVO_API_KEY }
      });

      setConnectionStatus('close');
      setQrCodeBase64(null);
      toast.success('Instância desconectada com sucesso!', { id: toastId });
    } catch (err: any) {
      toast.error('Erro ao desconectar: ' + (err?.message || 'Falha de rede'), { id: toastId });
    }
  };

  // 4. Polling automático enquanto o QR Code estiver visível
  useEffect(() => {
    if (!qrCodeBase64 || connectionStatus === 'open') return;

    const interval = setInterval(async () => {
      const inst = waInstance.trim();
      if (!inst) return;

      try {
        const response = await fetch(`${EVO_BASE_URL}/instance/connectionState/${inst}`, {
          method: 'GET',
          headers: { 'apikey': EVO_API_KEY }
        });
        if (response.ok) {
          const resData = await response.json();
          const state = resData?.instance?.state || resData?.state;
          if (state === 'open') {
            setConnectionStatus('open');
            setQrCodeBase64(null);
            toast.success('WhatsApp pareado com sucesso no terminal! 🎉');
          }
        }
      } catch (e) {}
    }, 4000);

    return () => clearInterval(interval);
  }, [qrCodeBase64, connectionStatus, waInstance]);

  useEffect(() => {
    async function loadSettings() {
      const { data, error } = await supabase
        .from('system_settings')
        .select('*')
        .eq('id', 'default')
        .single();

      if (data) {
        setDriveId(data.google_drive_folder_id || '');
        setReceiptFooter(data.receipt_footer || '');
        setWaApiUrl(data.whatsapp_api_url || '');
        setWaInstance(data.whatsapp_instance || '');
        if (data.whatsapp_instance) {
          void checkStatus(data.whatsapp_instance);
        }
      } else if (error && error.code !== 'PGRST116') {
        // PGRST116 é o erro de 'nenhuma linha encontrada', o que é normal na primeira vez
        console.error("Erro ao carregar configurações:", error);
      }
    }

    if (userRole === 'dono') {
      loadSettings();
    }
  }, [userRole]);

  const handleSave = async () => {
    setIsLoading(true);
    const toastId = toast.loading("Salvando configurações...");

    try {
      const { error } = await supabase.from('system_settings').upsert({
        id: 'default',
        google_drive_folder_id: driveId,
        receipt_footer: receiptFooter,
        whatsapp_api_url: waApiUrl,
        whatsapp_instance: waInstance,
        updated_at: new Date().toISOString()
      });

      if (error) throw error;

      toast.success("Configurações atualizadas com sucesso!", { id: toastId });
    } catch (error) {
      console.error(error);
      toast.error("Erro ao salvar no banco de dados.", { id: toastId });
    } finally {
      setIsLoading(false);
    }
  };

  if (userRole !== 'dono') {
    return (
      <div className="flex flex-col items-center justify-center h-[60vh] text-center">
        <Ban className="h-12 w-12 text-brand-muted mb-4" />
        <h2 className="text-xl font-bold text-brand-ink">Acesso Negado</h2>
        <p className="text-brand-muted mt-2">Apenas o dono do sistema tem acesso às configurações globais.</p>
      </div>
    );
  }

  return (
    <div className="space-y-6 animate-in fade-in slide-in-from-bottom-4 duration-500 pt-4 max-w-5xl mx-auto">
      {/* HEADER DA TELA */}
      <div className="flex flex-col sm:flex-row justify-between items-start sm:items-center gap-4">
        <div>
          <h2 className="text-2xl font-semibold text-foreground">Configurações do Terminal</h2>
          <p className="text-muted-foreground text-sm mt-1">Ajustes globais do sistema, integrações e personalização.</p>
        </div>
        <button 
          onClick={handleSave}
          disabled={isLoading}
          className="bg-brand-accent hover:brightness-110 text-brand-accent-fg px-6 py-2.5 rounded-full font-semibold transition-all shadow-sm flex items-center gap-2 text-sm disabled:opacity-50"
        >
          <Save className="h-4 w-4" />
          {isLoading ? 'Salvando...' : 'Salvar Configurações'}
        </button>
      </div>

      <div className="grid grid-cols-1 md:grid-cols-2 gap-6 pt-2">
        {/* PAINEL 1: GOOGLE DRIVE */}
        <Card className="shadow-sm">
          <CardHeader>
            <div className="flex items-center gap-2 mb-1">
              <HardDrive className="h-5 w-5 text-muted-foreground" />
              <CardTitle className="text-lg">Google Drive (Pasta Raiz)</CardTitle>
            </div>
            <CardDescription>O ID da pasta onde todas as sessões dos clientes serão salvas automaticamente.</CardDescription>
          </CardHeader>
          <CardContent>
            <div className="space-y-2">
              <label className="text-sm font-medium text-foreground">ID da Pasta</label>
              <Input 
                type="text" 
                value={driveId}
                onChange={(e) => setDriveId(e.target.value)}
                placeholder="Ex: 1A2b3C4d5E6f7G8h9I0jKlMnOpQrStUvWxYz"
                className="w-full h-11 px-4 rounded-xl border border-border bg-background text-foreground focus:outline-none focus:border-primary transition-colors font-mono text-sm"
              />
            </div>
          </CardContent>
        </Card>

        {/* PAINEL 2: IMPRESSÃO TÉRMICA */}
        <Card className="shadow-sm">
          <CardHeader>
            <div className="flex items-center gap-2 mb-1">
              <Receipt className="h-5 w-5 text-muted-foreground" />
              <CardTitle className="text-lg">Rodapé do Recibo (PDV)</CardTitle>
            </div>
            <CardDescription>Mensagem que será impressa no final do talão de compra térmica.</CardDescription>
          </CardHeader>
          <CardContent>
            <div className="space-y-2">
              <label className="text-sm font-medium text-foreground">Texto do Rodapé</label>
              <textarea 
                value={receiptFooter}
                onChange={(e) => setReceiptFooter(e.target.value)}
                placeholder="Ex: Obrigado por visitar a Setland! Acompanhe-nos no Instagram @setland."
                rows={3}
                className="w-full p-4 rounded-xl border border-border bg-background text-foreground focus:outline-none focus:border-primary transition-colors resize-none text-sm"
              />
            </div>
          </CardContent>
        </Card>

        {/* PAINEL 3: WHATSAPP & PAREAMENTO QR CODE */}
        <Card className="shadow-sm md:col-span-2">
          <CardHeader>
            <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-3">
              <div className="flex items-center gap-2 mb-1">
                <MessageCircle className="h-5 w-5 text-primary"/>
                <div>
                  <CardTitle className="text-lg">WhatsApp de Disparo Automático</CardTitle>
                  <CardDescription className="mt-0.5">
                    Conexão do robô de envio de links e entregas digitais aos visitantes.
                  </CardDescription>
                </div>
              </div>

              {/* Badge de Status da Conexão */}
              <div className="flex items-center gap-2">
                <div className={`inline-flex items-center gap-2 px-3.5 py-1.5 rounded-full text-xs font-semibold border backdrop-blur-sm shadow-sm ${
                  connectionStatus === 'open'
                    ? 'bg-emerald-500/10 text-emerald-600 dark:text-emerald-400 border-emerald-500/25'
                    : connectionStatus === 'connecting'
                    ? 'bg-amber-500/10 text-amber-600 border-amber-500/25 animate-pulse'
                    : 'bg-destructive/10 text-destructive border-destructive/25'
                }`}>
                  {connectionStatus === 'open' ? (
                    <>
                      <Wifi className="h-3.5 w-3.5 text-emerald-500"/>
                      <span>Conectado</span>
                    </>
                  ) : connectionStatus === 'connecting' ? (
                    <>
                      <Loader2 className="h-3.5 w-3.5 animate-spin text-amber-500"/>
                      <span>Aguardando Leitura...</span>
                    </>
                  ) : (
                    <>
                      <WifiOff className="h-3.5 w-3.5"/>
                      <span>Desconectado</span>
                    </>
                  )}
                </div>

                <button
                  type="button"
                  onClick={() => checkStatus()}
                  disabled={isCheckingStatus || !waInstance}
                  className="p-2 rounded-xl bg-card hover:bg-muted border border-border text-muted-foreground hover:text-foreground transition-colors shadow-sm disabled:opacity-50"
                  title="Verificar status da conexão agora"
                >
                  <RefreshCw className={`h-4 w-4 ${isCheckingStatus ? 'animate-spin' : ''}`} />
                </button>
              </div>
            </div>
          </CardHeader>

          <CardContent>
            <div className="grid grid-cols-1 md:grid-cols-2 gap-6 items-start">
              {/* Coluna 1: Campos de Configuração */}
              <div className="space-y-4">
                <div className="space-y-1.5">
                  <label className="text-sm font-medium text-foreground">Nome da Instância</label>
                  <Input 
                    type="text" 
                    value={waInstance}
                    onChange={(e) => setWaInstance(e.target.value)}
                    placeholder="Ex: setland"
                    className="w-full h-11 px-4 rounded-xl border border-border bg-background text-foreground focus:outline-none focus:border-primary transition-colors font-mono text-sm"
                  />
                  <p className="text-[11px] text-muted-foreground">Nome único da sessão criada na Evolution API.</p>
                </div>

                <div className="space-y-1.5">
                  <label className="text-sm font-medium text-foreground">URL do Webhook (n8n)</label>
                  <Input 
                    type="text" 
                    value={waApiUrl}
                    onChange={(e) => setWaApiUrl(e.target.value)}
                    placeholder="Ex: http://n8n.../webhook/setland-venda"
                    className="w-full h-11 px-4 rounded-xl border border-border bg-background text-foreground focus:outline-none focus:border-primary transition-colors font-mono text-sm"
                  />
                  <p className="text-[11px] text-muted-foreground">Endpoint que recebe os pedidos e dispara as mensagens personalizadas.</p>
                </div>

                {/* Ações de Conexão */}
                <div className="flex flex-wrap gap-2.5 pt-2">
                  <button
                    type="button"
                    onClick={handleGenerateQr}
                    disabled={isGeneratingQr || !waInstance}
                    className="flex-1 min-w-[160px] flex items-center justify-center gap-2 px-4 py-2.5 bg-primary text-primary-foreground font-semibold rounded-xl text-sm shadow-sm hover:opacity-90 active:scale-95 transition-all disabled:opacity-50"
                  >
                    <QrCode className="h-4 w-4"/>
                    {isGeneratingQr ? 'Gerando...' : 'Conectar / QR Code'}
                  </button>

                  {connectionStatus === 'open' && (
                    <button
                      type="button"
                      onClick={handleDisconnect}
                      className="flex items-center gap-2 px-4 py-2.5 bg-destructive/10 hover:bg-destructive/20 text-destructive border border-destructive/25 font-semibold rounded-xl text-sm transition-colors active:scale-95"
                    >
                      <LogOut className="h-4 w-4"/>
                      Desconectar
                    </button>
                  )}
                </div>
              </div>

              {/* Coluna 2: Box do QR Code / Status Visual */}
              <div className="flex flex-col items-center justify-center border-2 border-dashed border-border rounded-2xl p-6 min-h-[260px] bg-secondary/30 dark:bg-white/[0.02]">
                {qrCodeBase64 ? (
                  <div className="flex flex-col items-center text-center animate-in zoom-in-95 duration-200">
                    <div className="p-3 bg-white rounded-2xl shadow-xl border border-black/10">
                      <img 
                        src={qrCodeBase64} 
                        alt="QR Code WhatsApp" 
                        className="w-52 h-52 object-contain rounded-lg"
                      />
                    </div>
                    <div className="mt-4 space-y-1">
                      <p className="text-sm font-bold text-foreground flex items-center justify-center gap-1.5">
                        <Loader2 className="h-4 w-4 animate-spin text-primary"/>
                        Aguardando leitura do WhatsApp...
                      </p>
                      <p className="text-xs text-muted-foreground max-w-xs">
                        Abra o WhatsApp no celular &gt; <strong>Aparelhos conectados</strong> &gt; <strong>Conectar um aparelho</strong> e aponte para a tela.
                      </p>
                    </div>
                  </div>
                ) : connectionStatus === 'open' ? (
                  <div className="flex flex-col items-center text-center py-4">
                    <div className="w-16 h-16 rounded-full bg-emerald-500/10 text-emerald-600 dark:text-emerald-400 flex items-center justify-center mb-3 border border-emerald-500/20 shadow-sm">
                      <CheckCircle2 className="h-8 w-8"/>
                    </div>
                    <h4 className="text-base font-bold text-foreground">WhatsApp Conectado!</h4>
                    <p className="text-xs text-muted-foreground mt-1 max-w-xs">
                      O sistema está pronto para enviar links da vitrine e fotos do Google Drive automaticamente aos visitantes.
                    </p>
                  </div>
                ) : (
                  <div className="flex flex-col items-center text-center py-4">
                    <div className="w-16 h-16 rounded-full bg-muted flex items-center justify-center mb-3 border border-border shadow-sm text-muted-foreground">
                      <QrCode className="h-8 w-8"/>
                    </div>
                    <h4 className="text-base font-semibold text-foreground">Nenhuma Sessão Ativa</h4>
                    <p className="text-xs text-muted-foreground mt-1 max-w-xs">
                      Clique em <strong>Conectar / QR Code</strong> ao lado para autenticar o WhatsApp do quiosque em segundos.
                    </p>
                  </div>
                )}
              </div>
            </div>
          </CardContent>
        </Card>

        {/* PAINEL 4: MARCA D'ÁGUA */}
        <Card className="shadow-sm md:col-span-2">
          <CardHeader>
            <div className="flex items-center gap-2 mb-1">
              <ImageIcon className="h-5 w-5 text-muted-foreground" />
              <CardTitle className="text-lg">Marca d'água das Fotos</CardTitle>
            </div>
            <CardDescription>A imagem PNG com fundo transparente que será aplicada sobre as miniaturas geradas.</CardDescription>
          </CardHeader>
          <CardContent>
            <div className="border-2 border-dashed border-border bg-secondary/50 rounded-2xl p-10 flex flex-col items-center justify-center text-center cursor-pointer hover:bg-secondary transition-colors group">
              <div className="p-4 bg-background rounded-full shadow-sm mb-4 group-hover:scale-105 transition-transform">
                <ImageIcon className="h-8 w-8 text-muted-foreground" />
              </div>
              <p className="text-sm font-semibold text-foreground">Clique para alterar a watermark atual</p>
              <p className="text-xs text-muted-foreground mt-1">Recomendado: PNG 800x800px com fundo transparente</p>
            </div>
          </CardContent>
        </Card>

        {/* INFORMAÇÕES DO SISTEMA */}
        <div className="md:col-span-2 pt-2 pb-4 flex flex-col sm:flex-row items-center justify-between text-xs text-muted-foreground border-t border-border/50 gap-2">
          <div className="flex items-center gap-2">
            <span className="inline-block w-2 h-2 rounded-full bg-emerald-500 animate-pulse"></span>
            <span>Sistema Operacional &amp; Atualizado</span>
          </div>
          <span className="font-mono text-[11px] bg-secondary/80 px-2.5 py-1 rounded-md border border-border">
            Setland Fotos Desktop v{__APP_VERSION__}
          </span>
        </div>
      </div>
    </div>
  );
}
