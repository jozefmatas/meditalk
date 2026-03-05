export interface TemplateSection {
  id: string;
  labelKey: string;
  subsections?: TemplateSection[];
}

export interface Template {
  id: string;
  nameKey: string;
  descriptionKey: string;
  sections: TemplateSection[];
}
