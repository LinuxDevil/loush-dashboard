import Button from '../src/components/Button'

export default {
  title: 'Components/Button',
  component: Button,
  parameters: {
    controls: { expanded: true },
    design: { type: 'figma', url: 'https://www.figma.com/file/FILEKEY1/Styles-%2B-Components?node-id=601%3A5' },
  },
}

export const Basic = () => <Button>Go</Button>
