import { ConflictException, Injectable, NotFoundException, OnModuleInit } from '@nestjs/common';
import { InjectModel } from '@nestjs/mongoose';
import { Model, Types } from 'mongoose';
import { Category, CategoryDocument } from './category.schema';
import { CreateCategoryDto, UpdateCategoryDto } from './dto/category.dto';

@Injectable()
export class CategoriesService implements OnModuleInit {
  constructor(@InjectModel(Category.name) private categoryModel: Model<CategoryDocument>) {}

  async onModuleInit() {
    const count = await this.categoryModel.countDocuments();
    if (count === 0) {
      const initialCategories = [
        { name: 'Electronics', icon: 'smartphone' },
        { name: 'Textbooks', icon: 'book' },
        { name: 'Furniture', icon: 'sofa' },
        { name: 'Clothing & Accessories', icon: 'shirt' },
        { name: 'Kitchen & Dining', icon: 'utensils' },
        { name: 'Beauty & Personal Care', icon: 'smile' },
        { name: 'Sports & Outdoors', icon: 'basketball' },
        { name: 'Stationery & Art Supplies', icon: 'pen-tool' },
        { name: 'Musical Instruments', icon: 'music' },
        { name: 'Gaming', icon: 'gamepad-2' },
        { name: 'Services', icon: 'sparkles' },
      ];
      await this.categoryModel.insertMany(initialCategories);
      console.log('Seeded initial categories');
    }
  }

  async findAll() {
    return this.categoryModel.find().sort({ name: 1 }).exec();
  }

  async findById(id: string) {
    if (!Types.ObjectId.isValid(id)) throw new NotFoundException('Category not found');
    const category = await this.categoryModel.findById(id).exec();
    if (!category) throw new NotFoundException('Category not found');
    return category;
  }

  async create(dto: CreateCategoryDto) {
    const existing = await this.categoryModel.findOne({ name: dto.name.trim() }).exec();
    if (existing) throw new ConflictException(`Category "${dto.name}" already exists`);

    const category = new this.categoryModel({
      name: dto.name.trim(),
      icon: dto.icon?.trim() || 'tag',
    });
    return category.save();
  }

  async update(id: string, dto: UpdateCategoryDto) {
    if (!Types.ObjectId.isValid(id)) throw new NotFoundException('Category not found');

    if (dto.name) {
      const existing = await this.categoryModel.findOne({
        name: dto.name.trim(),
        _id: { $ne: id },
      }).exec();
      if (existing) throw new ConflictException(`Category "${dto.name}" already exists`);
    }

    const updateData: any = {};
    if (dto.name) updateData.name = dto.name.trim();
    if (dto.icon !== undefined) updateData.icon = dto.icon.trim();

    const category = await this.categoryModel
      .findByIdAndUpdate(id, updateData, { new: true })
      .exec();
    if (!category) throw new NotFoundException('Category not found');
    return category;
  }

  async delete(id: string) {
    if (!Types.ObjectId.isValid(id)) throw new NotFoundException('Category not found');
    const category = await this.categoryModel.findByIdAndDelete(id).exec();
    if (!category) throw new NotFoundException('Category not found');
    return { success: true, message: `Category "${category.name}" removed` };
  }
}
