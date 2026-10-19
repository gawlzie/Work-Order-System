import { CheckCircle2, ClipboardList, Smartphone, Timer, Wrench } from 'lucide-react';
import { Card, PageHeader } from '../components/ui';
import { useI18n } from '../lib/i18n';

export function AppDownloadPage() {
  const { t } = useI18n();
  const points = [
    { icon: ClipboardList, text: t('app_info_1') },
    { icon: Timer, text: t('app_info_2') },
    { icon: CheckCircle2, text: t('app_info_3') },
  ];
  return (
    <div>
      <PageHeader title={t('application')} />
      <Card className="overflow-hidden">
        <div className="grid items-center gap-8 p-6 sm:p-10 lg:grid-cols-2">
          <div>
            <span className="inline-flex items-center gap-2 rounded-full bg-primary/10 px-3 py-1 text-xs font-medium text-primary">
              <Smartphone className="size-3.5" /> Android
            </span>
            <h2 className="mt-4 text-2xl font-semibold sm:text-3xl">{t('app_title')}</h2>
            <ul className="mt-6 space-y-4">
              {points.map((p) => (
                <li key={p.text} className="flex gap-3">
                  <span className="flex size-9 shrink-0 items-center justify-center rounded-lg bg-sidebar-accent/15 text-sidebar-accent">
                    <p.icon className="size-5" />
                  </span>
                  <p className="pt-1.5 text-sm text-muted-foreground">{p.text}</p>
                </li>
              ))}
            </ul>
          </div>
          <div className="flex justify-center">
            <div className="relative h-[420px] w-[210px] rounded-[2.2rem] border-8 border-foreground/90 bg-background shadow-2xl">
              <div className="absolute top-2 left-1/2 h-4 w-20 -translate-x-1/2 rounded-full bg-foreground/90" />
              <div className="flex h-full flex-col gap-2 p-3 pt-9">
                <div className="flex items-center gap-2 rounded-lg bg-primary p-2 text-white">
                  <Wrench className="size-4" />
                  <span className="text-xs font-semibold">WO ITI</span>
                </div>
                {['DT 105', 'DT 112', 'DT 118', 'DT 103'].map((u, i) => (
                  <div key={u} className="rounded-lg border border-border bg-card p-2">
                    <div className="flex justify-between text-[10px]">
                      <span className="font-semibold">{u}</span>
                      <span className={['text-yellow-600', 'text-orange-500', 'text-blue-500', 'text-emerald-600'][i]}>
                        {['On Progress', 'Waiting', 'Open', 'Finish'][i]}
                      </span>
                    </div>
                    <div className="mt-1.5 h-1 rounded-full bg-muted">
                      <div className="h-full rounded-full bg-emerald-500" style={{ width: `${[60, 40, 0, 100][i]}%` }} />
                    </div>
                  </div>
                ))}
              </div>
            </div>
          </div>
        </div>
      </Card>
    </div>
  );
}
