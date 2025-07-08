import { render, RenderOptions } from '@testing-library/react'
import { ReactElement } from 'react'

//custom render function that includes providers
export const customRender = (
  ui: ReactElement,
  options?: Omit<RenderOptions, 'wrapper'>
) => {
  return render(ui, {
    ...options
  })
}

//re-export everything
export * from '@testing-library/react'
export { customRender as render }