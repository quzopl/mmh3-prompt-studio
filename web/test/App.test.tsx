import { describe, it, expect } from 'vitest'
import { render, screen } from '@testing-library/react'
import { App } from '../src/App.js'

describe('App', () => {
  it('renderuje nazwę aplikacji', () => {
    render(<App />)
    expect(screen.getByRole('banner')).toHaveTextContent('MMH3 Prompt Studio')
  })
})
