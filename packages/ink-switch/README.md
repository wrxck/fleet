# @matthesketh/ink-switch

An on/off toggle switch control for Ink 5 terminal UIs.

## Install

```
npm install @matthesketh/ink-switch
```

## Usage

```tsx
import { Switch } from '@matthesketh/ink-switch';

<Switch value={isOn} onChange={setIsOn} label="Wi-Fi" />
```

## Props

| Prop       | Type                      | Default   | Description                  |
|------------|---------------------------|-----------|------------------------------|
| `value`    | `boolean`                 | required  | Whether the switch is on     |
| `onChange`  | `(value: boolean) => void` | ---      | Called when toggled           |
| `label`    | `string`                  | ---       | Label shown after the toggle |
| `onLabel`  | `string`                  | `'ON'`    | Text shown when on           |
| `offLabel` | `string`                  | `'OFF'`   | Text shown when off          |
| `onColor`  | `string`                  | `'green'` | Ink color when on            |
| `offColor` | `string`                  | `'red'`   | Ink color when off           |
| `disabled` | `boolean`                 | `false`   | Dims the switch              |

## Visual

```
(*)--  ON   (green, on)
--(*)  OFF  (red, off)
```
