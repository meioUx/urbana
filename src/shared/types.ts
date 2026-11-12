export type Row = { id: string; [key: string]: any };
export type Boot = {
  user: Row;
  onboarding: any;
  catalogs: Row[];
  settings: any;
  roles: string[];
  priorities: string[];
  operators: Row[];
  kanban: {
    revision: number;
    limits: Record<string, number>;
    order: Record<string, string[]>;
  };
};
