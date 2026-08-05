import { describe, expect, it } from 'vitest'
import { ProjectSchema } from '../../src/model/schema.js'
import { newProject } from '../fixtures/newProject.js'

describe('ProjectSchema — unikalność identyfikatorów', () => {
  it('odrzuca dwa ujęcia o tym samym id', () => {
    const project = newProject()
    const first = project.shots[0]
    if (!first) throw new Error('fixture bez ujęć')
    const result = ProjectSchema.safeParse({
      ...project,
      shots: [first, { ...first, startMs: 4000 }],
    })
    expect(result.success).toBe(false)
  })

  it('odrzuca dwie etykiety o tym samym id', () => {
    const project = newProject()
    const label = { id: 'l1', kind: 'subject' as const, index: 1, assetIds: [], definition: 'x', role: 'y', standalone: false }
    const result = ProjectSchema.safeParse({ ...project, labels: [label, { ...label, index: 2 }] })
    expect(result.success).toBe(false)
  })

  it('odrzuca dwóch mówców o tym samym id', () => {
    const project = newProject()
    const speaker = {
      id: 'sp1', code: 'S1', characterType: 'baker', age: 'middle-aged', gender: 'male',
      pitch: 'low', timbre: 'raspy', rate: 'calm', accent: 'neutral', onScreen: true,
      fullDescriptor: 'the baker', shortDescriptor: 'the baker',
    }
    const result = ProjectSchema.safeParse({ ...project, speakers: [speaker, { ...speaker, code: 'S2' }] })
    expect(result.success).toBe(false)
  })

  it('odrzuca dwa assety o tym samym id', () => {
    const project = newProject()
    const asset = { id: 'a1', kind: 'image' as const, path: 'assets/one.png', fileName: 'one.png' }
    const result = ProjectSchema.safeParse({ ...project, assets: [asset, { ...asset, path: 'assets/two.png' }] })
    expect(result.success).toBe(false)
  })

  it('przyjmuje projekt o różnych identyfikatorach', () => {
    expect(ProjectSchema.safeParse(newProject()).success).toBe(true)
  })
})
