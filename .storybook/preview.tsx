import type { Preview } from '@storybook/nextjs-vite'
import '@fontsource-variable/figtree'
import '../src/app/globals.css'

const preview: Preview = {
  decorators: [
    (Story) => (
      <div className="bg-background text-foreground font-sans antialiased">
        <Story />
      </div>
    ),
  ],
  parameters: {
    controls: {
      matchers: {
        color: /(background|color)$/i,
        date: /Date$/i,
      },
    },
    a11y: {
      test: 'todo',
    },
  },
};

export default preview;
