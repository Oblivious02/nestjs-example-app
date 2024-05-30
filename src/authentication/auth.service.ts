import { PrismaService } from 'nestjs-prisma';
import {
  BadRequestException,
  ConflictException,
  Injectable,
  NotFoundException,
  UnauthorizedException,
} from '@nestjs/common';
import { JwtService } from '@nestjs/jwt';
import { Language, Prisma, User } from '@prisma/client';
import { AppConfigService } from '../config/app/app-config.service';
import { compare, hash } from 'bcrypt';
import { SignupInput } from './dto/signup.input';
import { Token } from './token.model';
import { AuthErrors } from './enums/auth-errors';
import { PublicErrors } from '../shared/enums/public-errors.enum';

@Injectable()
export class AuthService {
  constructor(
    private readonly jwtService: JwtService,
    private readonly prisma: PrismaService,
    private readonly appConfig: AppConfigService
  ) {}

  static validatePassword(password: string, hashedPassword: string): Promise<boolean> {
    return compare(password, hashedPassword);
  }

  async signup(payload: SignupInput, language: Language): Promise<Token> {
    const hashedPassword = await this.hashPassword(payload.password);

    try {
      const user = await this.prisma.user.create({
        data: {
          ...payload,
          language,
          password: hashedPassword,
        },
      });

      return this.generateTokens({
        userId: user.id,
      });
    } catch (e) {
      if (
        e instanceof Prisma.PrismaClientKnownRequestError &&
        e.code === AuthErrors.USER_DUPLICATED
      ) {
        throw new ConflictException({
          code: PublicErrors.USER_DUPLICATED,
          message: `Email ${payload.email} already used.`,
        });
      } else {
        throw new Error(e);
      }
    }
  }

  async login(email: string, password: string): Promise<Token> {
    const user = await this.prisma.user.findUnique({ where: { email }, include: { heroes: true } });

    if (!user) {
      throw new NotFoundException({
        code: PublicErrors.INVALID_CREDENTIALS,
        message: `Invalid credentials`,
      });
    }

    const passwordValid = await AuthService.validatePassword(password, user.password);

    if (!passwordValid) {
      throw new BadRequestException({
        code: PublicErrors.INVALID_CREDENTIALS,
        message: `Invalid credentials`,
      });
    }

    const tokens = this.generateTokens({
      userId: user.id,
    });

    return { ...tokens, ...user };
  }

  async deleteAccount(user: User, password: string) {
    const passwordValid = await AuthService.validatePassword(password, user.password);

    if (!passwordValid) {
      throw new BadRequestException({
        code: PublicErrors.INVALID_CREDENTIALS,
        message: `Invalid credentials`,
      });
    }

    await this.prisma.user.delete({
      where: { id: user.id },
    });

    return { ok: true };
  }

  async refreshToken(token: string): Promise<Token> {
    try {
      const { userId } = this.jwtService.verify(token, {
        secret: this.appConfig.jwtRefreshSecret,
      });

      return this.generateTokens({
        userId,
      });
    } catch (e) {
      throw new UnauthorizedException();
    }
  }

  generateTokens(payload: { userId: string }): Token {
    return {
      accessToken: this.generateAccessToken(payload),
      refreshToken: this.generateRefreshToken(payload),
    };
  }

  getUser(userId: string): Promise<User> {
    return this.prisma.user.findUnique({ where: { id: userId } });
  }

  getUserFromToken(token: string): Promise<User> {
    const id = this.jwtService.decode(token)['userId'];
    return this.getUser(id);
  }

  hashPassword(password: string): Promise<string> {
    return hash(password, Number(this.appConfig.bcryptSaltRounds));
  }

  private generateAccessToken(payload: { userId: string }): string {
    return this.jwtService.sign(payload);
  }

  private generateRefreshToken(payload: { userId: string }): string {
    return this.jwtService.sign(payload, {
      secret: this.appConfig.jwtRefreshSecret,
      expiresIn: this.appConfig.jwtRefreshIn,
    });
  }
}
