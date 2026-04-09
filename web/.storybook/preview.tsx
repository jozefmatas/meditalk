import type { Preview } from "@storybook/nextjs-vite";
import { NextIntlClientProvider } from "next-intl";
import { TooltipProvider } from "../src/components/shared/tooltip";
import "@fontsource-variable/figtree";
import "../src/app/globals.css";
import messages from "../messages/sk.json";

const preview: Preview = {
  decorators: [
    (Story) => (
      <NextIntlClientProvider locale="sk" messages={messages}>
        <TooltipProvider>
          <div className="bg-background text-foreground font-sans antialiased">
            <Story />
          </div>
        </TooltipProvider>
      </NextIntlClientProvider>
    ),
  ],
  parameters: {
    options: {
      storySort: {
        method: "alphabetical",
      },
    },
    controls: {
      matchers: {
        color: /(background|color)$/i,
        date: /Date$/i,
      },
    },
    nextjs: {
      appDirectory: true,
      navigation: {
        pathname: "/sk",
      },
    },
    a11y: {
      test: "todo",
    },
  },
};

export default preview;
