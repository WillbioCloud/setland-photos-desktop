import React, { useState, useEffect } from 'react';
import { Card, CardHeader, CardTitle, CardContent, CardDescription } from '@/components/ui/card';
import { Save, HardDrive, Receipt, Image as ImageIcon, Ban, MessageCircle } from 'lucide-react';
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

        {/* PAINEL 3: WHATSAPP */}
        <Card className="shadow-sm md:col-span-2 lg:col-span-1">
          <CardHeader>
            <div className="flex items-center gap-2 mb-1">
              <MessageCircle className="h-5 w-5 text-muted-foreground" />
              <CardTitle className="text-lg">WhatsApp de Disparo Automático</CardTitle>
            </div>
            <CardDescription>Instância e número de WhatsApp que enviará o link para os clientes.</CardDescription>
          </CardHeader>
          <CardContent className="space-y-4">
            <div className="space-y-2">
              <label className="text-sm font-medium text-foreground">URL da API / Webhook</label>
              <Input 
                type="text" 
                value={waApiUrl}
                onChange={(e) => setWaApiUrl(e.target.value)}
                placeholder="Ex: http://localhost:5678/webhook/setland-venda"
                className="w-full h-11 px-4 rounded-xl border border-border bg-background text-foreground focus:outline-none focus:border-primary transition-colors font-mono text-sm"
              />
            </div>
            <div className="space-y-2">
              <label className="text-sm font-medium text-foreground">Número ou Instância</label>
              <Input 
                type="text" 
                value={waInstance}
                onChange={(e) => setWaInstance(e.target.value)}
                placeholder="Ex: +55 (11) 99999-9999 ou Nome da Instância"
                className="w-full h-11 px-4 rounded-xl border border-border bg-background text-foreground focus:outline-none focus:border-primary transition-colors font-mono text-sm"
              />
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
      </div>
    </div>
  );
}
